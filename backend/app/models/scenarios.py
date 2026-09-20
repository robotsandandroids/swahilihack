from __future__ import annotations

from app.models.schemas import Difficulty, Scenario

# Initial scenario packs. Designed to be replaced/seedable from
# data/scenarios/*.json later without code changes.
SCENARIOS: list[Scenario] = [
    Scenario(
        id="market-tomatoes",
        title="Buying tomatoes at the market",
        title_sw="Kununua nyanya sokoni",
        context=(
            "You are at the market. A vendor is selling tomatoes and wants to know "
            "how many you'd like to buy."
        ),
        location="market",
        difficulty=Difficulty.beginner,
        opening_line=(
            "Karibu! Unataka nyanya ngapi? Hizi ni safi sana, za shambani."
        ),
        hint_sw="Sema unataka nyanya na uulize bei.",
        hint_en="Say you want tomatoes and ask how much they cost.",
        key_vocab=["nyanya", "ngapi", "bei", "kununua", "shilingi"],
    ),
    Scenario(
        id="taxi-fare",
        title="Negotiating a taxi fare",
        title_sw="Kujadili nauli ya teksi",
        context=(
            "A taxi driver tells you a price for a ride across town. You think it is "
            "too expensive and want to negotiate."
        ),
        location="taxi",
        difficulty=Difficulty.beginner,
        opening_line=(
            "Ndio tuende! Ni elfu kumi. Bei ya sasa, hakuna kupunguza."
        ),
        hint_sw="Sema hiyo ni ghali na omba bei nzuri.",
        hint_en="Say that is expensive and ask for a better price.",
        key_vocab=["nauli", "bei", "ghali", "rafuu", "elft"],
    ),
    Scenario(
        id="restaurant-order",
        title="Ordering food at a restaurant",
        title_sw="Kuagiza chakula mgahawani",
        context=(
            "You are at a restaurant. The waiter comes to take your order and "
            "recommends the fish of the day."
        ),
        location="restaurant",
        difficulty=Difficulty.beginner,
        opening_line=(
            "Habari za jioni! Leo tuna samaki wa kupikwa mchuzi, pamoja na wali. "
            "Utapenda kuagiza nini?"
        ),
        hint_sw="Agiza chakula na uulize kile wanachopendekeza.",
        hint_en="Order food and ask what they recommend.",
        key_vocab=["chakula", "samaki", "wali", "kuagiza", "menyu"],
    ),
    Scenario(
        id="greeting-older",
        title="Greeting an elder properly",
        title_sw="Kuamkua mzee",
        context=(
            "You meet an elderly neighbour in the morning. In Swahili culture you "
            "greet elders with respect and ask about their health."
        ),
        location="neighbourhood",
        difficulty=Difficulty.beginner,
        opening_line=(
            "Habari za asubuhi, mtoto wangu! Wewe hujambo? Vipi nyumbani?"
        ),
        hint_sw="Jibu salamu na uulize habari zake.",
        hint_en="Return the greeting and ask how they are.",
        key_vocab=["salamu", "hujambo", "habari", "shikamoo", "ahsante"],
    ),
    Scenario(
        id="clinic-complaint",
        title="Describing symptoms at the clinic",
        title_sw="Kueleza dalili klinikini",
        context=(
            "You do not feel well and you are at the clinic describing your symptoms "
            "to a nurse so they can help you."
        ),
        location="clinic",
        difficulty=Difficulty.intermediate,
        opening_line=(
            "Habari, karibu. Tangu jana nimeanza kuumwa kichwa na ninahisi joto "
            "asubuhi. Unajisikiaje leo?"
        ),
        hint_sw="Eleza maumivu na uonyeshe mahali maumivu yalipo.",
        hint_en="Describe your pains and show where it hurts.",
        key_vocab=["maumivu", "kichwa", "joto", "dalili", "kuumwa"],
    ),
    Scenario(
        id="bank-account",
        title="Opening a bank account",
        title_sw="Kufungua akaunti benki",
        context=(
            "You are in a bank trying to open a new account. The bank officer wants to "
            "know your details and what type of account you need."
        ),
        location="bank",
        difficulty=Difficulty.intermediate,
        opening_line=(
            "Habari, karibu benki. Unataka kufungua akaunti ya namna gani — "
            "akaunti ya kidogo au ya biashara?"
        ),
        hint_sw="Sema unahitaji akaunti ya kuweka pesa ya kibinafsi.",
        hint_en="Say you need an account to save personal money.",
        key_vocab=["akaunti", "pesa", "kuweka", "kutoa", "benki"],
    ),
    Scenario(
        id="directions-city",
        title="Asking for directions in town",
        title_sw="Kuuliza mwelekeo",
        context=(
            "You are lost in a busy town centre and need to find the post office. You "
            "ask a passer-by for directions."
        ),
        location="town",
        difficulty=Difficulty.intermediate,
        opening_line=(
            "Samahani rafiki! Naweza kukusaidia? Unaonekana una shida, nikuongoze?"
        ),
        hint_sw="Uulize jinsi ya kufika posta.",
        hint_en="Ask how to get to the post office.",
        key_vocab=["mwelekeo", "posta", "kushoto", "kulia", "moja kwa moja"],
    ),
    Scenario(
        id="phone-repair",
        title="Complaining about a phone repair",
        title_sw="Kulalamika kuhusu ukarabati wa simu",
        context=(
            "You left your phone for repair two weeks ago and it is not ready. You "
            "politely but firmly ask the technician what is going on."
        ),
        location="phone_shop",
        difficulty=Difficulty.advanced,
        opening_line=(
            "Karibu rafiki! Ahaa, wewe uliyemwacha simu yako wiki mbili zilizopita. "
            "Pole, bado imekamilika?"
        ),
        hint_sw="Lalamika kwa adabu kuhusu kucheleweshwa.",
        hint_en="Politely complain about the delay and ask for a date.",
        key_vocab=["kuchelewa", "ukarabati", "simu", "subira", "adhani"],
    ),
    Scenario(
        id="job-interview",
        title="Job interview",
        title_sw="Mahojiano ya kazi",
        context=(
            "You are in a job interview for a position at a Swahili-speaking company. "
            "The interviewer wants to know about your experience and skills."
        ),
        location="office",
        difficulty=Difficulty.advanced,
        opening_line=(
            "Karibu, karibu! Tutambulikane. Utujulishe juu ya elimu yako na uzoefu "
            "uliokuwa nao kazini."
        ),
        hint_sw="Jieleze ukitumia lugha ya heshima.",
        hint_en="Introduce yourself using respectful language.",
        key_vocab=["uzoefu", "elimu", "mahojiano", "stadi", "kuajiriwa"],
    ),
    Scenario(
        id="renting-house",
        title="Renting a house",
        title_sw="Kukodi nyumba",
        context=(
            "You are talking to a landlord about a house you want to rent. You need to "
            "know the rent, water, and when you can move in."
        ),
        location="real_estate",
        difficulty=Difficulty.advanced,
        opening_line=(
            "Karibu uone nyumba. Mwezi ni laki moja, maji ni ya ziada. Ungependa "
            "kuieliza nini kwanza?"
        ),
        hint_sw="Uulize kuhusu kodi, maji, na wakati wa kuingia.",
        hint_en="Ask about the rent, water, and when you can move in.",
        key_vocab=["kodi", "nyumba", "maji", "kuingia", "mkataba"],
    ),
]


def list_scenarios() -> list[Scenario]:
    return SCENARIOS


def get_scenario(scenario_id: str) -> Scenario | None:
    for s in SCENARIOS:
        if s.id == scenario_id:
            return s
    return None