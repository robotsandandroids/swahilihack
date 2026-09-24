import json
import requests


def lookup_swahili_word(target_word):
    url = "https://kaikki.org/dictionary/Swahili/kaikki.org-dictionary-Swahili.jsonl"

    print(f"Searching for '{target_word}'...")
    with requests.get(url, stream=True) as response:
        for line in response.iter_lines():
            if line:
                entry = json.loads(line.decode("utf-8"))
                if entry.get("word", "").lower() == target_word.lower():
                    return entry
    return None


# Example usage:
result = lookup_swahili_word("lia")
if result:
    print(json.dumps(result, indent=2, ensure_ascii=False))
else:
    print("Word not found.")
