# Setting up a new Private customer — step by step

This is the plain-English version of "how does a new Private customer actually
get connected." No code required to follow this — it just tells you what to
do, in order, and what to ask the customer for.

Private tier means: this customer gets their own dedicated AI setup, running
on a server they pay for and own (in their own AWS, Google Cloud, or Azure
account), not shared with anyone else. Quorum's app talks to their server
over the internet the same way it talks to any AI provider — just to a
server that belongs to them instead of a public company.

---

## Part 1 — What you need to do first (before talking deploy tooling)

### 1. Have the sales conversation, get three answers

Before anything technical happens, you need three things from the
customer:

1. **Which cloud do they use (or want to use)?** AWS, Google Cloud, or
   Azure. If they don't have one yet, they'll need to create an account —
   that's on them, not you.
2. **Qwen or Mistral?** These are the two AI model families Private tier can
   run. Mistral is European; Qwen is Chinese-origin but generally
   considered to have the best output quality among the two. This is a
   real trade-off the customer should knowingly pick, not something you
   decide for them.
3. **What web address (domain) do they want their private connection to
   live at?** Something like `theircompanyname.private.quorum.app` — either
   a subdomain you set up for them, or a domain they own and control
   themselves.

### 2. Turn on their access in the system

This is a quick, one-time database update you (or whoever has admin access)
do yourself — no customer involvement needed for this specific step. It
marks their account as "Private tier" and records their Qwen/Mistral choice.
Nothing changes for them yet — this just flags them as eligible; their
actual private server doesn't exist yet.

---

## Part 2 — What the customer needs to provide

Before you can actually deploy their server, get these from them:

| What you need | Why |
|---|---|
| **Access to their cloud account** (AWS/GCP/Azure) — either they give you temporary access, or they run the deploy steps themselves while you guide them | This is where their server gets created. It has to be built inside *their* account, not yours, so they own it and pay for it directly. |
| **Confirmation their cloud account can actually rent the powerful (GPU) servers this needs** | Cloud providers don't allow this by default on a brand-new account — the customer usually has to request permission first, and this can take anywhere from a few minutes to a few business days. Ask them to check/request this *early*, not on deploy day. |
| **Control over the domain/web address** from step 3 above (Part 1) | Once their server is running, you need to point that web address at it. If it's a subdomain of Quorum's own domain, you handle this. If it's their own company domain, they need to make the change on their end, or give you access to do it. |

---

## Part 3 — Actually deploying their server

This is the part that involves the technical scripts, but from your side
as the person running it, it's mostly: run one command, wait, and follow
the prompts.

1. **Run the deploy script**, telling it: which cloud, which customer,
   Qwen or Mistral, and the web address from Part 1. It automatically:
   - Creates a fresh, unique password (API key) just for this customer —
     never reused, never shared with anyone else
   - Builds their server in their cloud account, sized for running the AI
     model
   - Installs everything needed to run it and keep it updated automatically

2. **Point their web address at the new server.** The script will pause
   and tell you the server's address (an IP number) — this is the one
   manual step where you (or the customer, if it's their own domain) update
   a DNS setting to point their chosen web address at that number.

3. **Wait for it to finish starting up.** The script checks automatically
   and tells you once it's ready — this can take several minutes, since the
   AI model itself is large and takes time to load.

4. **The script registers the finished connection** with Quorum's main
   system automatically — this is the step that actually makes their
   account start using their new private server instead of the shared one.

That's it — the customer is now live on their own dedicated setup.

---

## Part 4 — What happens automatically afterward (nothing you need to do)

- **Improvements and bug fixes roll out on their own.** Their server checks
  every 15 minutes for updates from Quorum and installs them safely — it
  tests a new version before switching to it, and if anything looks wrong,
  it automatically keeps running the older, working version instead. You
  don't need to redeploy anything manually when Quorum ships an update.
- **You can check on any customer's deployment status at a glance** —
  which version they're running, when it last confirmed it was healthy —
  without needing to log into their cloud account at all.

---

## Part 5 — What you'll need to redo for each *new* Private customer

Everything in Parts 1–3, from the top, once per customer. Nothing here is
shared between customers — each one gets their own server, their own
password, their own address, in their own cloud account.

## What's not fully built yet (be aware, don't promise these to a customer yet)

- **Sizing hasn't been tested against real usage yet.** The server size
  picked automatically is a reasonable starting guess, not something proven
  under real load — worth watching closely with your first couple of
  customers.
- **No automatic cost estimate is shown to the customer before they commit**
  — you'll want to give them a rough monthly cloud-cost expectation
  yourself, in conversation, before they agree to Private tier.
- **The domain/DNS step is still manual**, not automatic.
