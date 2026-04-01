"""
main.py — CLI entry point for Aziro Ops.
Run: python3 main.py
"""
import json
import re
import datetime
from sandbox  import execute, SANDBOX_MODE
from tools    import is_destructive
from prompts  import build_system_prompt
from providers import chat, TOOL_MODEL, ANSWER_MODEL

LOG_FILE    = f"session_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
MAX_HISTORY = 20
MAX_STEPS   = 5


def log(text):
    with open(LOG_FILE, "a") as f:
        f.write(text + "\n")


def trim_messages(messages):
    system  = [m for m in messages if m["role"] == "system"]
    history = [m for m in messages if m["role"] != "system"]
    return system + history[-MAX_HISTORY:]


def check_provider():
    ollama_models = {m.split("/")[-1] for m in [TOOL_MODEL, ANSWER_MODEL] if "ollama" in m}
    if ollama_models:
        import subprocess
        result = subprocess.run("ollama list", shell=True, capture_output=True, text=True)
        if result.returncode != 0:
            print("ERROR: Ollama is not running. Start it with: ollama serve")
            exit(1)
        for model_name in ollama_models:
            if model_name not in result.stdout:
                print(f"ERROR: Model '{model_name}' not found. Run: ollama pull {model_name}")
                exit(1)


check_provider()

messages = [{"role": "system", "content": build_system_prompt()}]

if TOOL_MODEL == ANSWER_MODEL:
    print(f"Aziro Ops (model: {TOOL_MODEL}, sandbox: {SANDBOX_MODE})")
else:
    print(f"Aziro Ops")
    print(f"  Tool model:   {TOOL_MODEL}   ← runs commands")
    print(f"  Answer model: {ANSWER_MODEL}  ← writes final answer")
    print(f"  Sandbox: {SANDBOX_MODE}")
print(f"Session log: {LOG_FILE}\n")

while True:
    question = input("You: ").strip()
    if not question:
        continue
    if question.lower() == "exit":
        print("Goodbye!")
        break

    log(f"\nYou: {question}")
    messages.append({"role": "user", "content": question})
    messages = trim_messages(messages)

    gave_final_answer = False
    commands_run      = 0
    ran_commands      = set()

    for step in range(MAX_STEPS):
        try:
            reply, command, tool_call_id = chat(messages, use_tools=True)
        except Exception as e:
            print(f"\n[ERROR] AI provider failed: {e}\n")
            log(f"[ERROR] {e}")
            break

        if command:
            if command in ran_commands:
                messages.append({"role": "assistant", "content": reply or "", "tool_calls": [{"id": tool_call_id, "type": "function", "function": {"name": "run_command", "arguments": json.dumps({"command": command})}}]})
                messages.append({"role": "tool", "content": "[Already ran this command.]", "tool_call_id": tool_call_id})
                messages = trim_messages(messages)
                continue

            if re.search(r'<[^>]+>', command):
                messages.append({"role": "assistant", "content": reply or "", "tool_calls": [{"id": tool_call_id, "type": "function", "function": {"name": "run_command", "arguments": json.dumps({"command": command})}}]})
                messages.append({"role": "tool", "content": f"[ERROR] Command contains a placeholder: {command}", "tool_call_id": tool_call_id})
                messages = trim_messages(messages)
                continue

            if is_destructive(command):
                confirm = input(f"\n[WARNING] {command}\nAre you sure? (y/n): ").strip().lower()
                if confirm != "y":
                    print("[Skipped]\n")
                    log(f"[Skipped] {command}")
                    messages.append({"role": "assistant", "content": reply or "", "tool_calls": [{"id": tool_call_id, "type": "function", "function": {"name": "run_command", "arguments": json.dumps({"command": command})}}]})
                    messages.append({"role": "tool", "content": "[User declined to run this command]", "tool_call_id": tool_call_id})
                    messages = trim_messages(messages)
                    continue

            commands_run += 1
            ran_commands.add(command)
            print(f"\n[Running: {command}]")
            log(f"[Running] {command}")
            output = execute(command)
            print(f"[Output]\n{output}")
            log(f"[Output]\n{output}")

            messages.append({"role": "assistant", "content": reply or "", "tool_calls": [{"id": tool_call_id, "type": "function", "function": {"name": "run_command", "arguments": json.dumps({"command": command})}}]})
            messages.append({"role": "tool", "content": output, "tool_call_id": tool_call_id})
            messages = trim_messages(messages)

        else:
            if ANSWER_MODEL != TOOL_MODEL and commands_run > 0:
                print(f"\n[Switching to {ANSWER_MODEL} for final answer...]")
                try:
                    reply, _, _ = chat(messages, use_tools=False)
                except Exception as e:
                    log(f"[ERROR] Answer model failed: {e}")

            messages.append({"role": "assistant", "content": reply})
            print(f"\nAI: {reply}\n")
            log(f"AI: {reply}")
            gave_final_answer = True
            break

    if not gave_final_answer:
        print(f"\n[Collected {MAX_STEPS} rounds — summarizing...]\n")
        try:
            summary, _, _ = chat(messages, use_tools=False)
        except Exception as e:
            summary = f"[Could not generate summary: {e}]"
        messages.append({"role": "assistant", "content": summary})
        print(f"AI: {summary}\n")
        log(f"AI: {summary}")
