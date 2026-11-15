# PhishGuard — Campaign Runtime

The minimal runtime a PhishGuard **campaign server** clones and runs. It contains
only what a server needs to run a campaign and report telemetry back to the
control plane — not the control-plane backend/frontend.

The PhishGuard control plane deploys this automatically over SSH when a campaign
is activated: it installs Docker, clones this repo, injects per-campaign
environment, and runs the compose file below. You normally don't run these
commands by hand.

## Layout

```
deploy/campaign-compose.yml   # the composition the control plane runs
novnc/Dockerfile              # Chrome-for-Testing + noVNC + Site Tweaker
novnc/start.sh                # launches Xvfb, x11vnc, websockify, Chrome
site-tweaker/site-tweaker/    # the Chrome extension, mounted read-only
agent/                        # Python agent: reports data back over RabbitMQ
```

## What runs

Two containers, on one private network:

1. **novnc** — headless Chrome for Testing (with Site Tweaker) on a virtual
   display, exposed over noVNC on port `6080`. Chrome opens the campaign target
   (`START_URL`) on launch, so the live, tweakable "modified site" is viewable
   at `http://<server-ip>:6080/vnc_lite.html`.
2. **agent** — connects OUT to the central RabbitMQ (`PHISHGUARD_AMQP_URL`) and
   publishes campaign telemetry to the control plane: an activation result,
   periodic heartbeats, and coarse `session.notification` events (which URL the
   browser navigated to, when a session joined/left). It observes the browser
   over CDP and records **metadata only** — never passwords, cookies, session
   tokens, or keystrokes (STRATEGY.md sections 5.4, 11, 13).

## Data that flows back

| Event | Meaning |
|---|---|
| `campaign.activated` | agent is up, reports its version |
| `agent.heartbeat`    | agent liveness every 30s |
| `session.notification` | coarse browser activity (join/leave/navigation) |

The control plane consumes these and updates the campaign's dashboard.

## Environment the control plane injects

| Variable | Purpose |
|---|---|
| `START_URL` | URL Chrome opens (the campaign target) |
| `NOVNC_PORT` | host port for the noVNC UI (default 6080) |
| `PHISHGUARD_AMQP_URL` | reachable RabbitMQ URL (your tunnel) the agent dials |
| `PHISHGUARD_AGENT_ID` | this agent's UUID |
| `PHISHGUARD_CAMPAIGN_ID` | the campaign UUID (message isolation) |

## Manual run (for testing)

From the repo root:

```bash
START_URL="https://example.com" NOVNC_PORT=6080 \
PHISHGUARD_AMQP_URL="amqp://guest:guest@YOUR_BROKER:5672/" \
PHISHGUARD_AGENT_ID="$(uuidgen)" PHISHGUARD_CAMPAIGN_ID="$(uuidgen)" \
  docker compose -f deploy/campaign-compose.yml -p phishguard_test up -d --build
```

Requirements on the server: Docker + the compose plugin, outbound internet, port
`6080` reachable, and network reachability to your RabbitMQ broker.
