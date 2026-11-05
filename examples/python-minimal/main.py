"""
Esempio minimo Python con helper di questo repo.

pip install composio composio-openai-agents openai-agents
python main.py
"""

import os
from agents import Agent, Runner
from composio import Composio
from composio_openai_agents import OpenAIAgentsProvider

# Se gli helper sono nello stesso repo:
# from helpers.python.session_helpers import create_session_with_retry

def main() -> None:
    composio = Composio(
        api_key=os.environ["COMPOSIO_API_KEY"],
        provider=OpenAIAgentsProvider(),
    )

    session = composio.create(user_id="demo-user")
    print("Session ID:", session.session_id)

    tools = session.tools()

    agent = Agent(
        name="Demo Assistant",
        instructions="Rispondi in italiano. Usa i tool solo se necessario.",
        tools=tools,
    )

    result = Runner.run_sync(
        starting_agent=agent,
        input="Quante email non lette ho?",
    )
    print("Output:", result.final_output)


if __name__ == "__main__":
    main()
