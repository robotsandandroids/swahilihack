"""Custom logging utility for tracking model actions and reasoning.

This module provides enhanced logging capabilities to capture:
- Model reasoning steps
- Action sequences
- Decision-making processes
- Tool usage and outputs
"""

import logging
import json
import traceback
from datetime import datetime
from typing import Any, Dict, Optional


# Create a custom logger for reasoning and actions
reasoning_logger = logging.getLogger("reasoning")
action_logger = logging.getLogger("actions")
model_logger = logging.getLogger("model_decisions")

# Configure formatters if not already configured
def _setup_logger(logger: logging.Logger, level: int = logging.INFO) -> None:
    """Set up a logger with a standard formatter if it has no handlers."""
    if not logger.handlers:
        handler = logging.StreamHandler()
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        logger.setLevel(level)
        logger.propagate = False  # Prevent duplicate logs


# Initialize loggers
_setup_logger(reasoning_logger)
_setup_logger(action_logger)
_setup_logger(model_logger)


def log_reasoning_step(step: str, context: Optional[Dict[str, Any]] = None) -> None:
    """Log a reasoning step taken by the model.
    
    Args:
        step: Description of the reasoning step
        context: Optional contextual information
    """
    log_entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "type": "reasoning_step",
        "step": step,
    }
    
    if context:
        log_entry["context"] = context
    
    reasoning_logger.info(json.dumps(log_entry))


def log_action(action: str, parameters: Optional[Dict[str, Any]] = None,
               result: Any = None) -> None:
    """Log an action taken by the model or system.
    
    Args:
        action: Description of the action performed
        parameters: Optional parameters passed to the action
        result: Optional result/output of the action
    """
    log_entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "type": "action",
        "action": action,
    }
    
    if parameters is not None:
        log_entry["parameters"] = parameters
    
    if result is not None:
        # Try to serialize result, fallback to string representation
        try:
            json.dumps(result)  # Test if serializable
            log_entry["result"] = result
        except (TypeError, ValueError):
            log_entry["result"] = str(result)
    
    action_logger.info(json.dumps(log_entry))


def log_model_decision(decision: str, alternatives: Optional[list] = None,
                       confidence: Optional[float] = None,
                       reasoning: Optional[str] = None) -> None:
    """Log a decision made by the model.
    
    Args:
        decision: The decision that was made
        alternatives: Alternative options considered
        confidence: Confidence level in the decision (0.0 to 1.0)
        reasoning: Explanation of why this decision was made
    """
    log_entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "type": "model_decision",
        "decision": decision,
    }
    
    if alternatives is not None:
        log_entry["alternatives"] = alternatives
    
    if confidence is not None:
        log_entry["confidence"] = confidence
    
    if reasoning is not None:
        log_entry["reasoning"] = reasoning
    
    model_logger.info(json.dumps(log_entry))


def log_error(error: Exception, context: Optional[str] = None) -> None:
    """Log an error with traceback information.
    
    Args:
        error: The exception that occurred
        context: Optional context where the error occurred
    """
    log_entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "type": "error",
        "error_type": type(error).__name__,
        "error_message": str(error),
    }
    
    if context:
        log_entry["context"] = context
    
    # Add traceback information
    log_entry["traceback"] = traceback.format_exc()
    
    # Log to all relevant loggers
    reasoning_logger.error(json.dumps(log_entry))
    action_logger.error(json.dumps(log_entry))
    model_logger.error(json.dumps(log_entry))


def log_session_start(session_id: str, scenario: Optional[str] = None,
                      character: Optional[str] = None) -> None:
    """Log the start of a tutoring session.
    
    Args:
        session_id: Unique identifier for the session
        scenario: The scenario being used (if applicable)
        character: The character role being played (if applicable)
    """
    log_entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "type": "session_start",
        "session_id": session_id,
    }
    
    if scenario:
        log_entry["scenario"] = scenario
    
    if character:
        log_entry["character"] = character
    
    action_logger.info(json.dumps(log_entry))


def log_session_end(session_id: str, turn_count: Optional[int] = None,
                    duration_seconds: Optional[float] = None) -> None:
    """Log the end of a tutoring session.
    
    Args:
        session_id: Unique identifier for the session
        turn_count: Number of turns in the session
        duration_seconds: Duration of the session in seconds
    """
    log_entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "type": "session_end",
        "session_id": session_id,
    }
    
    if turn_count is not None:
        log_entry["turn_count"] = turn_count
    
    if duration_seconds is not None:
        log_entry["duration_seconds"] = duration_seconds
    
    action_logger.info(json.dumps(log_entry))


# Convenience functions for common logging patterns
def log_llm_call(provider: str, model: str, prompt_length: int,
                 response_length: int, tokens_used: Optional[int] = None) -> None:
    """Log an LLM API call.
    
    Args:
        provider: LLM provider (e.g., "mistral", "openai", "gemini")
        model: Model name used
        prompt_length: Length of the prompt in characters
        response_length: Length of the response in characters
        tokens_used: Number of tokens used (if known)
    """
    log_entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "type": "llm_call",
        "provider": provider,
        "model": model,
        "prompt_length": prompt_length,
        "response_length": response_length,
    }
    
    if tokens_used is not None:
        log_entry["tokens_used"] = tokens_used
    
    action_logger.info(json.dumps(log_entry))


def log_feedback_generated(feedback_type: str, score: Optional[int] = None,
                          corrections_count: int = 0) -> None:
    """Log when feedback is generated for a learner response.
    
    Args:
        feedback_type: Type of feedback (e.g., "grammar", "comprehension")
        score: Numerical score if applicable
        corrections_count: Number of corrections provided
    """
    log_entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "type": "feedback_generated",
        "feedback_type": feedback_type,
        "corrections_count": corrections_count,
    }
    
    if score is not None:
        log_entry["score"] = score
    
    model_logger.info(json.dumps(log_entry))


# Example usage:
if __name__ == "__main__":
    # Example of how to use the logging functions
    log_session_start("session_123", scenario="market", character="vendor")
    log_reasoning_step("Analyzing learner's Swahili sentence for grammar errors", 
                      {"sentence": "Ninakula apple jana"})
    log_model_decision(
        decision="Mark tense error as repeat_error=true",
        alternatives=[{"option": "teach_rule", "confidence": 0.3}, 
                     {"option": "repeat_error", "confidence": 0.7}],
        confidence=0.7,
        reasoning="Learner made same tense error in previous turn"
    )
    log_action("call_llm", 
              {"provider": "mistral", "model": "mistral-small"},
              {"ai_text": "Nikapenda matunda!", "feedback": {"grammar": 80}})
    log_feedback_generated("grammar", score=80, corrections_count=1)
    log_session_end("session_123", turn_count=5, duration_seconds=120.5)