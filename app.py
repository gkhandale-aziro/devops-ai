"""
app.py — web server entry point.
All routes live in ui/web.py. This file only starts the server.
Run: python3 app.py
"""
from ui.web import app, _llm

if __name__ == "__main__":
    print("Aziro Ops — Web")
    print(f"  Tool model:   {_llm.tool_model}")
    print(f"  Answer model: {_llm.answer_model}")
    print(f"  URL: http://localhost:5000\n")
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
