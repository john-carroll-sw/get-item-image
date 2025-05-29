import os
from openai import OpenAI
from dotenv import load_dotenv


# Load environment variables from .env file
load_dotenv()

client = OpenAI(
    api_key=os.getenv("AZURE_OPENAI_API_KEY"),
    base_url=os.getenv("AZURE_OPENAI_V1_API_ENDPOINT"),
    default_query={"api-version": "preview"}, 
)

resp = client.responses.create(
  model=os.environ["AZURE_OPENAI_API_MODEL"],
  tools=[
    {
      "type": "code_interpreter",
      "container": { "type": "auto" }
    }
  ],
  instructions="You are a personal math tutor. When asked a math question, write and run code to answer the question.",
  input="I need to solve the equation 3x + 11 = 14. Can you help me?",
)

print(resp.output_text)