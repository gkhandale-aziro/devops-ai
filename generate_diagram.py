"""
generate_diagram.py — Generate Aziro Ops architecture PNG
Run: python3 generate_diagram.py
Output: architecture.png
"""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

fig, ax = plt.subplots(1, 1, figsize=(18, 13))
fig.patch.set_facecolor('#0d1117')
ax.set_facecolor('#0d1117')
ax.set_xlim(0, 18)
ax.set_ylim(0, 13)
ax.axis('off')

# ── Colors ────────────────────────────────────────────────────────────────────
C_BG       = '#0d1117'
C_BORDER   = '#30363d'
C_ACCENT   = '#79c0ff'
C_GREEN    = '#56d364'
C_ORANGE   = '#e3b341'
C_PURPLE   = '#bc8cff'
C_BLUE     = '#1f6feb'
C_RED      = '#ff7b72'
C_TEXT     = '#e6edf3'
C_SUBTEXT  = '#8b949e'
C_BOX      = '#161b22'
C_BOX2     = '#1c2128'

def box(ax, x, y, w, h, color=C_BOX, border=C_BORDER, radius=0.3, lw=1.2):
    rect = FancyBboxPatch((x, y), w, h,
        boxstyle=f"round,pad=0,rounding_size={radius}",
        linewidth=lw, edgecolor=border, facecolor=color, zorder=2)
    ax.add_patch(rect)

def label(ax, x, y, text, size=9, color=C_TEXT, bold=False, ha='center', va='center'):
    weight = 'bold' if bold else 'normal'
    ax.text(x, y, text, fontsize=size, color=color, ha=ha, va=va,
            fontweight=weight, zorder=3, fontfamily='monospace')

def arrow(ax, x1, y1, x2, y2, color=C_SUBTEXT):
    ax.annotate('', xy=(x2, y2), xytext=(x1, y1),
        arrowprops=dict(arrowstyle='->', color=color, lw=1.5), zorder=3)

# ── Title ─────────────────────────────────────────────────────────────────────
label(ax, 9, 12.5, 'Aziro Ops — Architecture', size=16, color=C_ACCENT, bold=True)

# ── Browser layer ─────────────────────────────────────────────────────────────
box(ax, 0.5, 9.8, 17, 2.3, color='#111827', border=C_ACCENT, lw=1.5)
label(ax, 9, 11.75, 'Browser  (ui-dashboard.html)', size=10, color=C_ACCENT, bold=True)

# Dashboard box
box(ax, 0.9, 10.0, 4.2, 1.5, color=C_BOX2, border=C_BORDER)
label(ax, 3.0, 11.2,  'Dashboard', size=9, color=C_TEXT, bold=True)
label(ax, 3.0, 10.85, '· Overview · Kubernetes', size=7.5, color=C_SUBTEXT)
label(ax, 3.0, 10.58, '· Logs · Network · Storage', size=7.5, color=C_SUBTEXT)
label(ax, 3.0, 10.3,  '· AI Panel (server chat)', size=7.5, color=C_SUBTEXT)

# AI Chat box
box(ax, 6.3, 10.0, 4.4, 1.5, color=C_BOX2, border=C_BORDER)
label(ax, 8.5, 11.2,  'AI Chat', size=9, color=C_TEXT, bold=True)
label(ax, 8.5, 10.85, '· Session sidebar', size=7.5, color=C_SUBTEXT)
label(ax, 8.5, 10.58, '· Saved history', size=7.5, color=C_SUBTEXT)
label(ax, 8.5, 10.3,  '· Streaming responses', size=7.5, color=C_SUBTEXT)

# Resource Modal box
box(ax, 11.9, 10.0, 4.2, 1.5, color=C_BOX2, border=C_BORDER)
label(ax, 14.0, 11.2,  'Resource Modal', size=9, color=C_TEXT, bold=True)
label(ax, 14.0, 10.85, '· kubectl describe', size=7.5, color=C_SUBTEXT)
label(ax, 14.0, 10.58, '· Logs / Prev logs', size=7.5, color=C_SUBTEXT)
label(ax, 14.0, 10.3,  '· AI Analysis', size=7.5, color=C_SUBTEXT)

# ── Arrow: Browser → Flask ────────────────────────────────────────────────────
arrow(ax, 9, 9.8, 9, 9.05)
label(ax, 10.2, 9.42, 'HTTP / SSE streaming', size=7.5, color=C_SUBTEXT)

# ── Flask API layer ───────────────────────────────────────────────────────────
box(ax, 0.5, 7.8, 17, 1.1, color='#111827', border=C_BLUE, lw=1.5)
label(ax, 9, 8.65, 'Flask API  (app.py)', size=10, color=C_BLUE, bold=True)
label(ax, 4.5, 8.15, '/api/targets    /api/tab    /api/resource    /api/chat', size=8, color=C_SUBTEXT)
label(ax, 9.5, 7.92, '/api/sessions    /api/sessions/<id>/chat/stream    /api/analyze', size=8, color=C_SUBTEXT)

# ── Arrows: Flask → modules ───────────────────────────────────────────────────
arrow(ax, 2.8, 7.8, 2.8, 7.1)
arrow(ax, 9.0, 7.8, 9.0, 7.1)
arrow(ax, 15.2, 7.8, 15.2, 7.1)

# ── targets.py ────────────────────────────────────────────────────────────────
box(ax, 0.5, 4.2, 4.5, 2.8, color=C_BOX, border=C_BORDER)
label(ax, 2.75, 6.7,  'targets.py', size=9, color=C_GREEN, bold=True)
label(ax, 2.75, 6.38, 'Connection CRUD', size=8, color=C_TEXT)
label(ax, 2.75, 6.08, '─────────────────', size=7, color=C_BORDER)
label(ax, 2.75, 5.78, '📄 targets.json', size=8, color=C_SUBTEXT)
label(ax, 2.75, 5.5,  '    connections', size=7.5, color=C_SUBTEXT)
label(ax, 2.75, 5.2,  '📄 chat_sessions', size=8, color=C_SUBTEXT)
label(ax, 2.75, 4.92, '    .json', size=7.5, color=C_SUBTEXT)
label(ax, 2.75, 4.55, 'prompts.py', size=8, color=C_SUBTEXT)
label(ax, 2.75, 4.3,  'system prompts', size=7.5, color=C_SUBTEXT)

# ── executors.py ──────────────────────────────────────────────────────────────
box(ax, 6.75, 4.2, 4.5, 2.8, color=C_BOX, border=C_BORDER)
label(ax, 9.0, 6.7,  'executors.py', size=9, color=C_ORANGE, bold=True)
label(ax, 9.0, 6.38, 'Run commands on targets', size=8, color=C_TEXT)
label(ax, 9.0, 6.08, '─────────────────', size=7, color=C_BORDER)
label(ax, 9.0, 5.78, 'SSH  (paramiko)', size=8, color=C_SUBTEXT)
label(ax, 9.0, 5.5,  'kubectl', size=8, color=C_SUBTEXT)
label(ax, 9.0, 5.22, 'docker daemon', size=8, color=C_SUBTEXT)
label(ax, 9.0, 4.94, 'aws / gcloud / az', size=8, color=C_SUBTEXT)
label(ax, 9.0, 4.66, 'terraform', size=8, color=C_SUBTEXT)
label(ax, 9.0, 4.38, 'local shell', size=8, color=C_SUBTEXT)

# ── providers.py ──────────────────────────────────────────────────────────────
box(ax, 12.5, 4.2, 4.8, 2.8, color=C_BOX, border=C_BORDER)
label(ax, 14.9, 6.7,  'providers.py', size=9, color=C_PURPLE, bold=True)
label(ax, 14.9, 6.38, 'LiteLLM  (100+ models)', size=8, color=C_TEXT)
label(ax, 14.9, 6.08, '─────────────────', size=7, color=C_BORDER)
label(ax, 14.9, 5.78, 'TOOL_MODEL', size=8, color=C_SUBTEXT, bold=True)
label(ax, 14.9, 5.5,  'Ollama / Groq (fast)', size=7.5, color=C_SUBTEXT)
label(ax, 14.9, 5.22, '─────────────────', size=7, color=C_BORDER)
label(ax, 14.9, 4.92, 'ANSWER_MODEL', size=8, color=C_SUBTEXT, bold=True)
label(ax, 14.9, 4.64, 'Claude / GPT-4 / Gemini', size=7.5, color=C_SUBTEXT)
label(ax, 14.9, 4.36, 'Bedrock / Mistral / more', size=7.5, color=C_SUBTEXT)

# ── Arrow: executors → infra ──────────────────────────────────────────────────
arrow(ax, 9.0, 4.2, 9.0, 3.45)

# ── Infrastructure layer ──────────────────────────────────────────────────────
box(ax, 0.5, 0.4, 17, 2.9, color='#111827', border=C_BORDER, lw=1.2)
label(ax, 9, 3.1, 'Your Infrastructure', size=10, color=C_TEXT, bold=True)

infra = [
    (1.2,  '#58a6ff', 'Server\n(SSH)'),
    (3.7,  '#326CE5', 'Kubernetes'),
    (6.2,  '#2496ED', 'Docker'),
    (8.7,  '#FF9900', 'AWS'),
    (11.2, '#4285F4', 'GCP'),
    (13.7, '#0078D4', 'Azure'),
    (16.2, '#7B42BC', 'Terraform'),
]
for (xi, col, name) in infra:
    box(ax, xi - 0.95, 0.65, 1.9, 2.1, color=C_BOX2, border=col, lw=1.5)
    lines = name.split('\n')
    if len(lines) == 2:
        label(ax, xi, 1.85, lines[0], size=8, color=col, bold=True)
        label(ax, xi, 1.55, lines[1], size=8, color=col, bold=True)
    else:
        label(ax, xi, 1.75, name, size=8, color=col, bold=True)

# ── Legend ────────────────────────────────────────────────────────────────────
legend_items = [
    (C_ACCENT,  'UI Layer'),
    (C_BLUE,    'API Layer'),
    (C_GREEN,   'Data / Storage'),
    (C_ORANGE,  'Execution'),
    (C_PURPLE,  'AI / LLM'),
]
for i, (col, lbl) in enumerate(legend_items):
    bx = 0.7 + i * 3.4
    box(ax, bx, 0.08, 0.22, 0.22, color=col, border=col)
    label(ax, bx + 0.55, 0.19, lbl, size=7.5, color=C_SUBTEXT, ha='left')

plt.tight_layout(pad=0.3)
plt.savefig('architecture.png', dpi=150, bbox_inches='tight',
            facecolor=C_BG, edgecolor='none')
print("Saved: architecture.png")
