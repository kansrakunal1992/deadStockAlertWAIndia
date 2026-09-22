# Quorum — getting found in AI answers: everything outside the code

This is the companion to `quorum_geo_patch.zip`. That zip handles the code
side (robots.txt, sitemap.xml, llms.txt, FAQ/Organization schema, homepage
metadata). Everything below is what has to happen outside the repo for any
of that to actually matter. Steps are ordered — do them roughly in this
order, since later ones depend on earlier ones.

---

## 0. Apply the code patch

1. Unzip `quorum_geo_patch.zip`.
2. Copy these files into your project, overwriting where a path already
   exists:
   - `app/robots.ts` — new
   - `app/sitemap.ts` — new
   - `public/llms.txt` — new
   - `app/layout.tsx` — replaces your current one (adds structured data;
     everything else is untouched)
   - `app/page.tsx` — replaces your current one (now a thin wrapper — see
     below)
   - `app/HomeClient.tsx` — new. This **is** your old `app/page.tsx`
     content, moved here unchanged. The new `app/page.tsx` just imports and
     renders it, so it can carry its own page title/description.
   - `components/FAQSection.tsx` — replaces your current one (adds the
     FAQ's schema markup; the visible accordion is untouched)
3. Set the `NEXT_PUBLIC_APP_URL` environment variable in Railway to your
   **real production domain** (e.g. `https://quorum.yourdomain.com`), not
   the placeholder or the `*.railway.app` URL. Several of the new files use
   this to build absolute URLs for the sitemap, robots.txt, and structured
   data.
4. Commit and deploy as usual.
5. Verify it worked — visit each of these on your live domain and confirm
   they load:
   - `/robots.txt`
   - `/sitemap.xml`
   - `/llms.txt`
6. Validate the structured data: go to
   [search.google.com/test/rich-results](https://search.google.com/test/rich-results),
   paste in your homepage URL, and confirm both the `FAQPage` and
   `SoftwareApplication` blocks parse with no errors. Do the same for the
   homepage again after any future FAQ edits.

---

## 1. Get indexed properly

- [ ] **Google Search Console** — [search.google.com/search-console](https://search.google.com/search-console),
  add your domain as a property, verify ownership (DNS TXT record or HTML
  file — Search Console walks you through it), then submit
  `https://your-domain/sitemap.xml` under Sitemaps.
- [ ] **Bing Webmaster Tools** — [bing.com/webmasters](https://www.bing.com/webmasters).
  Worth doing separately from Google: ChatGPT's search results draw
  substantially from Bing's index, so this isn't optional if ChatGPT
  visibility matters to you. You can import your verified site directly
  from Google Search Console (one click) instead of re-verifying from
  scratch. Submit your sitemap here too.

---

## 2. Disambiguate "Quorum" everywhere you show up

The name collision (the public-affairs company at quorum.us, plus several
unrelated "AI council" products also called Quorum/QuorumAI) means the bare
word "Quorum" alone won't reliably point an AI engine at you. Fix by never
using it alone:

- [ ] Update every external bio (LinkedIn company page, X/Twitter, founder's
  personal bios, any directory listing) to include the qualifier — "Quorum
  — Private Decision Intelligence" or "Quorum (the Council + Mirror)", not
  bare "Quorum."
- [ ] Check handle availability for something more specific if your current
  handles are just "@quorum" variants that are easily confused —
  `@quorumhq`, `@tryquorum`, `@askquorum`, etc. Not mandatory, but worth 10
  minutes of checking.
- [ ] Add one explicit disambiguation sentence somewhere prominent and
  linkable — an About/company page is a natural home (`/llms.txt` already
  has one; mirror it in human-readable copy).

---

## 3. Own "judgment compounding"

Nobody prominent has already claimed this exact term. That's a real, if
narrow, opening — but only if there's one canonical, quotable definition
that gets reused consistently.

- [ ] Write one clean, self-contained definition — 1–3 sentences, no
  jargon, something a model could lift and cite directly. Something in the
  shape of: *"Judgment compounding is [what it is] — measured by
  [how Quorum measures it], as opposed to [static/one-off decision
  quality]."* Put it on `/methodology` near the existing "confidence
  compounds" language, since that page already has its own metadata.
- [ ] Reuse that **exact sentence**, word for word, in your Product Hunt
  description, any LinkedIn/founder posts about the concept, and any press
  pitch. Consistency across independent sources is what lets an engine
  learn to associate the term with you specifically.

---

## 4. Get listed where AI engines actually pull corroboration from

This is the highest-leverage category and the one your own site can't do
alone — AI engines weigh independent, third-party mentions far more than
self-description.

- [ ] **G2** — [g2.com/products/new](https://www.g2.com/products/new) (free
  to create a listing). Category: something like "Decision Support
  Software" or "AI Business Assistant" — browse G2's category list and pick
  the closest fit. Fill in the description using your disambiguated copy.
- [ ] **Capterra** — [capterra.com/vendors](https://www.capterra.com/vendors/sign-up),
  same idea, similar category.
- [ ] **AlternativeTo** — submit Quorum as an alternative under a few
  adjacent tools (decision journals, AI assistants, advisory/coaching
  apps) at [alternativeto.net](https://alternativeto.net).
- [ ] **Product Hunt** — plan an actual launch, not a quiet listing:
  1. Prep assets ahead of time: logo, a few gallery screenshots, and a
     one-line tagline using your disambiguated framing (not bare "Quorum").
  2. Pick a launch day (Tuesday–Thursday tend to get more traffic).
  3. Have the founder personally reply to every comment that day — this
     matters both for Product Hunt's own ranking and because those threads
     get indexed and read by search/AI crawlers later.

---

## 5. Publish what you're already collecting

- [ ] You already have a case-study submission pipeline in the codebase,
  but nothing public uses it yet. Even a simple `/stories` or
  `/case-studies` page with 3–5 real, specific outcomes (with numbers where
  possible) is exactly the kind of "original data" AI engines favor citing
  over generic marketing copy. This is a code change, not in this patch —
  happy to build it next if useful.
- [ ] Consider publishing one distinctive, specific statistic periodically
  (e.g., a real number about what Council sessions catch that users didn't
  flag themselves). A single original number other people end up citing
  back to you is worth more than pages of generic copy.

---

## 6. Show up where your actual audience already talks about tools

- [ ] Participate genuinely (answer questions, don't pitch) in communities
  your target users — founders, CXOs, family office principals — actually
  read: r/startups, r/Entrepreneur, Indie Hackers, relevant founder
  Slack/Discord groups.
- [ ] If India is a primary market (your pricing is in ₹), a founder
  interview or guest post in YourStory, Inc42, or Entrepreneur India is a
  natural, achievable press target — those outlets get cited and indexed
  heavily in this exact founder/CXO niche.

---

## 7. Test it, on a schedule

This is the actual feedback loop — more reliable than guessing which
tactic above is working.

- [ ] Every 2–4 weeks, ask ChatGPT, Gemini, Claude, and Perplexity the same
  handful of target questions and note what comes back. A starter list:
  - "What's a good AI tool for high-stakes personal decisions?"
  - "What is judgment compounding?"
  - "AI council of advisors for decision making"
  - "Apps like Quorum for decisions" *(to see whether disambiguation is working)*
  - "How do I reduce bias in a big decision?"
- [ ] Keep a simple running log — even a plain spreadsheet: date, question,
  engine, whether Quorum came up, and what source it cited (if any). After
  a couple of months this tells you which of the tactics above is actually
  moving the needle, so you can drop what isn't and double down on what is.
