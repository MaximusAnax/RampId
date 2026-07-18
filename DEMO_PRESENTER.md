# Veridian — Presenter Cheat Sheet

Silent hotkeys · ~7 min demo · branch `experiment/demo-exceptional`

**Product:** Veridian · **Customer:** Vantix AI · Core path works **offline** (no network required).

---

## Hotkeys

| Key | Action | When it works |
|-----|--------|----------------|
| **Enter** | Enter / return to Vantix cluster | Swarm view only |
| **O** | Surface SynapseFlow opportunity now | Cluster + opportunity still `hidden` |
| **D** | Deploy agents (start SynapseFlow) | Cluster + opportunity `ready` + scenario not started |
| **W** | Re-run what-if alternate | Cluster + what-if `armed` or `finished` **and** Nova spend ≥ **$10,000** |
| **B** | Pull back to org swarm | Cluster + scenario idle **or** resolved (escalated) |
| **Shift+R** | Hard reset → cold open | Always (same as **Reset Demo**) |

Hotkeys ignore focus in inputs / textareas / contenteditable.

---

## Click path (~7 min)

| Beat | Do this | Notes |
|------|---------|--------|
| Cold open | Leave swarm running | Don’t speak for ~3s |
| Enter | **Enter** or “Enter Vantix AI” | Zooms into cluster |
| Opportunity | Wait **~12s** or press **O** | Card: *SynapseFlow — 40% Lower Cost — $240,000…* |
| Deploy | **D** or “Deploy agents to investigate” | Starts main SynapseFlow story |
| Story | Narrate feed / block / trust reweight | Ends when opportunity → **escalated** |
| What-if | Open **NOVA** → raise spend past **$10k** | Arms alternate branch panel |
| Re-run | **W** or “Re-run alternate timeline” | Cautionary ending (~$18.4k exposure) |
| Close | **B** or “Pull back” | Tagline: *Trust is the infrastructure* |

---

## What-if (Part 5)

1. Finish main story → opportunity **escalated** (Sentinel blocked Nova).
2. Click **NOVA** → drag spending limit past **$10,000** (slider max **$25,000**).
3. Panel arms: *“Nova would have advanced the transaction before Sentinel could intervene.”*
4. Press **W** or **Re-run alternate timeline**.
5. Watch Nova advance before Sentinel; finish on outcome callout:  
   *Same vendor. One number. Nova committed $18,400 before Sentinel could stop it…*

**W gating:** only when armed/finished **and** Nova ≥ $10k. Lower the slider below $10k and it disarms.

---

## Tips

- **Reset Demo** (status bar) or **Shift+R** — full cold open if anything glitches.
- Opportunity auto-reveals **12s** after cluster entry; press **O** if you’re ahead of the script.
- Don’t click into form fields while presenting — hotkeys won’t fire.
- Pull-back (**B**) is blocked mid-scenario; wait for idle or escalated/resolved.
- After pull-back with a resolved story, close tagline lands on swarm — say it once, stop talking.
- Create Agent / OpenAI are optional polish; demo story is local simulation.
