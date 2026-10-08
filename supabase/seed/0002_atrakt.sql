-- Atrakt pilot seed: client, pod, integrations, sources, Source of Truth v1 (all Proposed unless stated by Sako),
-- Klaviyo flow inventory as read on 2026-10-07, the Sept 17 audit as Proposed scores, findings, agent jobs.
-- Nothing here is Approved: approval is a human action in the app.

-- ids
-- client   10000000-0000-4000-8000-000000000001
-- sources  20000000-0000-4000-8000-00000000000N
-- users    sako ...0001  drew ...0002  andre ...0003  jc ...0004

insert into public.clients (id, name, slug, website, objective) values
 ('10000000-0000-4000-8000-000000000001', 'Atrakt', 'atrakt', 'https://atrakt.com',
  'Move revenue from one-and-done TikTok Shop buyers to owned, repeat, subscription-based website revenue; Q4 2026 is the first fully in-stock selling season.')
on conflict (id) do update set objective = excluded.objective;

insert into public.client_assignments (client_id, user_id, role_on_client) values
 ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'admin'),
 ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'account_lead'),
 ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'contributor'),
 ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004', 'account_lead')
on conflict do nothing;

insert into public.integrations (client_id, system, mode, status, external_account_id, external_account_name, scope_note, last_verified_at) values
 ('10000000-0000-4000-8000-000000000001', 'klaviyo', 'read', 'connected', 'RSeVCG', 'ATRAKT (support@atrakt.com)', 'Read-only: account, flows, lists, segments, reports, metrics, forms, billing', '2026-10-07T00:00:00Z'),
 ('10000000-0000-4000-8000-000000000001', 'clickup', 'write', 'connected', '1400430000002521', 'ATRAKT (ATK) folder under Pod 4 (Drew)', 'Task create/update mirror; lists: ATK-Flows, ATK-Projects, ATK-Client Dependencies, ATK-Cmd Ctr', '2026-10-07T00:00:00Z'),
 ('10000000-0000-4000-8000-000000000001', 'shopify', 'read', 'pending', '00wvh3-sh.myshopify.com', 'atrakt.com', 'Authorization pending; previously pointed at the wrong store', null),
 ('10000000-0000-4000-8000-000000000001', 'onetext', 'upload', 'not_connected', null, 'One Text', 'No API; CSV uploads. Sako and Drew have platform access.', null),
 ('10000000-0000-4000-8000-000000000001', 'slack', 'link', 'connected', 'C0C52SGF6G7', '#atrakt-wavy-team (client) and #internal-atrakt (C0C7PC39RAL)', 'Approval permalinks recorded as evidence', '2026-10-07T00:00:00Z'),
 ('10000000-0000-4000-8000-000000000001', 'fireflies', 'read', 'connected', null, 'Wavy Studios Fireflies', 'Transcript import', '2026-10-07T00:00:00Z'),
 ('10000000-0000-4000-8000-000000000001', 'figma', 'link', 'pending', null, null, 'Client to share existing file; Wavy builds its own', null),
 ('10000000-0000-4000-8000-000000000001', 'gdrive', 'upload', 'pending', null, null, 'Client assets promised 2026-10-05', null)
on conflict (client_id, system) do update set mode = excluded.mode, status = excluded.status, scope_note = excluded.scope_note;

insert into public.sources (id, client_id, kind, title, url, external_id, captured_at, uploaded_by) values
 ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'transcript', 'Atrakt x Wavy Studios Lifecycle Marketing Call (audit / sales)', 'https://app.fireflies.ai/view/01M2KWTYTP26W3CTNQRNVGCA2G', '01M2KWTYTP26W3CTNQRNVGCA2G', '2026-09-17', '00000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'transcript', 'Atrakt x Wavy Studios Onboarding', 'https://app.fireflies.ai/view/01M3X0NEC3G2VM7E1QXE8Z8WEQ', '01M3X0NEC3G2VM7E1QXE8Z8WEQ', '2026-10-05', '00000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'link', 'ClickUp ATRAKT (ATK) folder', 'https://app.clickup.com/t/17tnw2b37x7', '1400430000002521', '2026-10-07', '00000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'platform_report', 'Klaviyo account, flows and lists read (connector)', null, 'RSeVCG', '2026-10-07', '00000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'note', 'Sako intake answers (LCOS setup chat)', null, null, '2026-10-07', '00000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

-- ---------- Source of Truth v1 ----------
-- S1 = Sept 17 call, S2 = Oct 5 onboarding, S3 = ClickUp, S4 = Klaviyo read, S5 = Sako intake
with s as (select
  '10000000-0000-4000-8000-000000000001'::uuid c,
  '20000000-0000-4000-8000-000000000001'::uuid s1, '20000000-0000-4000-8000-000000000002'::uuid s2,
  '20000000-0000-4000-8000-000000000003'::uuid s3, '20000000-0000-4000-8000-000000000004'::uuid s4,
  '20000000-0000-4000-8000-000000000005'::uuid s5,
  '00000000-0000-4000-8000-000000000001'::uuid sako)
insert into public.facts (client_id, category, statement, status, source_id, source_quote, proposed_by_kind, proposed_by, verified_by, verified_at, review_due)
select c, cat::app.fact_category, stmt, st::app.fact_status, src, quote, 'user', sako,
       case when st = 'verified' then sako end, case when st = 'verified' then now() end, due::date
from s, (values
 -- business objective
 ('business_objective', 'Primary objective: shift revenue from one-and-done TikTok Shop buyers to owned, repeat, subscription-based website revenue.', 'proposed', 's1', 'most of our revenue is coming from TikTok shop and people see our videos one time they buy [09:49]', '2027-01-15'),
 ('business_objective', 'Q4 2026 is the first quarter with inventory in stock throughout; prior cycle was drop / sell-out / 8-week restock.', 'proposed', 's2', 'This is our first like Q4 where we have inventory [10:10]', '2027-01-15'),
 ('business_objective', 'Revenue target from email+SMS was stated three ways on the audit call ($200k/month; $250k additional; 20% of business = $2M/year) and must be taken from the signed SOW.', 'proposed', 's1', 'you should be making at least 200,000 a month off your emails, emailing, SMS [11:40]', '2026-10-21'),
 ('business_objective', 'Biggest lifecycle problem: flows are thin, broken, and off-brand for the audience, with a large never-emailed opted-in list idle.', 'proposed', 's1', '84% of buyers have never placed a second order [16:33]; welcome flow links go to old domain [17:04]', '2027-01-15'),
 -- stakeholders
 ('stakeholders', 'Artemi Bukin (artemibukin@gmail.com) is the client principal and approves client-facing work.', 'proposed', 's2', 'he just sends me, hey, are these emails good enough? And then that posts them [04:37, S1]', '2027-01-15'),
 ('stakeholders', 'A partner on the client side (transcribed as "Katie") must be looped in on quarterly plans; name and approval role unconfirmed.', 'proposed', 's1', 'I want him to understand ... how do you envision our next few quarters going [37:02]', '2026-10-21'),
 ('stakeholders', 'Drew (Andrew Lauchner) is the Wavy day-to-day operator; Sako gives internal approval; Andre handles design.', 'verified', 's5', 'you will want to make Drew the operator not me', '2027-01-15'),
 -- products and launches
 ('products_launches', 'Debo (debloat powder) is the hero SKU: about 80% of sales, roughly 120,000 units sold on TikTok Shop; other SKUs around 10,000 each.', 'proposed', 's2', 'I think it''s like 80% of all of our sales is just the Debo powder [10:39]', '2027-01-15'),
 ('products_launches', 'Debo Lite: electrolyte stick packs (1,000 mg potassium, dandelion root, 3 g cane sugar, 10 kcal), 24 sticks for $29, launched website-exclusive on 2026-09-18.', 'proposed', 's2', 'we have 24 sticks for $29 [11:36]; launching dbolt Lite tomorrow, exclusive website only [28:53, S1]', '2027-01-15'),
 ('products_launches', 'Other current SKUs: B Clear (skin capsules), C Volume (hair / DHT), U Glo (tanning gummies).', 'proposed', 's2', 'We have B Clear ... C volume ... U Glo [12:23]', '2027-01-15'),
 ('products_launches', 'Sleep gummy (no melatonin) due to launch the week of 2026-10-05; 3D renders exist.', 'proposed', 's2', 'It should go live. I think at the end of this week. It has no melatonin [12:49]', '2026-10-21'),
 ('products_launches', 'Frost Berry holiday flavor returns 2026-12-01 for December and January; 10,000 units ordered.', 'proposed', 's2', 'we''ll have that on the 1st of December ... I''m only ordering 10,000 units [26:22]', '2026-11-15'),
 ('products_launches', 'Pipeline: energy pouches (caffeine, no nicotine), creatine-based supplements, gum in R&D; written roadmap promised by Artemi.', 'proposed', 's2', 'I''ll write it out for you [16:14]', '2026-10-21'),
 ('products_launches', 'January 2027: premium frosted-glass packaging, new website, and loyalty program launch together; held until after Q4.', 'proposed', 's2', 'We''re only kicking off in January, so we''re holding off on this until after Q4 [15:34]', '2026-12-01'),
 -- pricing
 ('pricing_economics', 'All products retail at $29.99; COGS roughly $4 to $6 per unit (highest about $5.50).', 'proposed', 's2', 'all of our products sell for 2999 ... in that 4 or 5 $6 range [18:14]', '2027-01-15'),
 ('pricing_economics', 'Premium glass Debo planned at $39.99 in January 2027.', 'proposed', 's2', 'we do want to raise the price to be 39.99 [18:35]', '2027-01-15'),
 ('pricing_economics', 'TikTok Shop sells at $29.99 with free shipping; the website requires 3 units for free shipping, so a single-unit site order costs about $41 at checkout.', 'proposed', 's2', 'on website, you have to buy three units to get free shipping [25:45]', '2026-11-15'),
 ('pricing_economics', 'Site conversion rate about 2%; a CRO contractor is fixing funnel, bundles, and subscriptions in a two-week sprint from 2026-10-05.', 'proposed', 's2', 'our conversion is like overall around a 2% [23:29]', '2026-10-21'),
 -- audience
 ('customer_audience', 'Core audience: male, 16 to 30, TikTok-native; younger teens also reach out though products are labelled 18+.', 'proposed', 's2', 'our target market right now are kids that are like from 16 to max, like 30 ... they''re all guys [17:28]', '2027-01-15'),
 ('customer_audience', 'Reviews average 4.4 stars; recurring complaints are taste and the tub looking half-empty (30 servings by weight).', 'proposed', 's2', 'we have a 4.4 star rating ... a lot of people are like, oh, I''m getting scammed [19:21]', '2027-01-15'),
 ('customer_audience', 'No voice-of-customer or brand-voice document exists; reviews and TikTok comments are the raw material.', 'proposed', 's2', 'We don''t have like built out documents [19:08]', '2026-10-21'),
 ('customer_audience', 'Repeat purchase is the core gap: audit found 84% of buyers never placed a second order (to re-verify in Klaviyo).', 'proposed', 's1', '84% of buyers have never placed a second order [16:33]', '2026-10-21'),
 -- brand voice
 ('brand_voice', 'Rebranded from Ascend Labs to Atrakt about 2.5 months before 2026-10-05 after roughly 9 to 10 months operating; renders were photoshopped, not reshot.', 'proposed', 's2', 'We just switched over about a month and a half, two months ago to Attract [03:26]', '2027-01-15'),
 ('brand_voice', 'Brand direction: moving from "looksmaxxing" toward premium health; benchmark brands AG1 and Seed; long-term vision includes an "Atrakt Health" line and run-club community.', 'proposed', 's2', 'we''re trying to go more health focused ... that''s why I''m thinking ag1 seed [12:06, 14:46]', '2027-01-15'),
 ('brand_voice', 'Email should carry the TikTok community energy and speak to a young audience; the incumbent agency''s copy skewed older and disconnected.', 'proposed', 's1', 'targeting like an older crowd ... when it''s like we have younger clients [24:53]', '2027-01-15'),
 ('brand_voice', 'Prohibited: any "Ascend Labs" reference in copy or alt text, and any link to the old domain.', 'proposed', 's1', 'a win-back email still says Ascend Labs [19:04]', '2027-01-15'),
 -- claims
 ('claims_compliance', 'Approved claims list and certification documents have not been received; ClickUp task open.', 'proposed', 's3', 'Approved Claims List + Cert Docs — status to do', '2026-10-21'),
 ('claims_compliance', 'TikTok removed before/after debloat videos as false-hope promotion; avoid outcome-guarantee framing.', 'proposed', 's2', 'TikTok started taking down a bunch of them ... promoting like false hope [20:37]', '2027-01-15'),
 -- offers
 ('offers_discounts', 'No approved offer set exists; the welcome offer decision (one offer, depth, stacking) is an open ClickUp task.', 'proposed', 's3', 'Welcome Offer Decision (One Offer, Depth, Stacking) — status to do', '2026-10-21'),
 ('offers_discounts', 'Client preference: percent-off framing over dollar-off at the $29.99 price point ("$3 off" reads as worthless).', 'proposed', 's1', 'Everyone''s like what the [f] is $3? [29:46]', '2027-01-15'),
 ('offers_discounts', 'Existing mechanic: review-for-10%-off-next-order email; client wants a points / "10th order free" loyalty program in January.', 'proposed', 's1', 'give us a review and you get 10 off your next order [10:06]', '2027-01-15'),
 -- platforms
 ('platforms_access', 'Email on Klaviyo (account ATRAKT, id RSeVCG, sender support@atrakt.com); SMS on One Text; store on Shopify (00wvh3-sh.myshopify.com); tasks in ClickUp; messaging in Slack.', 'verified', 's5', 'Klaviyo email and One Text for SMS ... atrakt.com, 00wvh3-sh.myshopify.com ... clickup ... slack', '2027-01-15'),
 ('platforms_access', 'One Text: client-run, ~80k texts/month historically, upgraded to a 200,000 texts/month plan, RCS verified-sender application pending; account rep available.', 'proposed', 's2', 'we sent maybe 80k like text messages [02:06]; just upgraded contract to 200,000 [33:20, S1]', '2026-11-15'),
 ('platforms_access', 'Incumbent email agency is finishing its month of campaigns (about $1,500 to $2,000/month); Wavy builds flows in draft until they are off to avoid overlap.', 'proposed', 's2', 'if we want to have it in like draft mode and we can just like look at it [08:35]', '2026-11-01'),
 -- lists and consent
 ('lists_segments_consent', 'Klaviyo lists: Email List (double opt-in), SMS List, ONETEXT_USERS, ONETEXT_TEMP, LYTE (created 2026-08-18), DELAYED, SMS TEST, Preview List, "SE - Suppress List Aug 6th 2026".', 'verified', 's4', 'get_lists read 2026-10-07', '2026-11-07'),
 ('lists_segments_consent', 'About 37,000 to 38,000 SMS subscribers; SMS out-earns email today.', 'proposed', 's1', '37,000 people subscribe to the messages [30:50]', '2026-11-07'),
 ('lists_segments_consent', 'Audit claim: 10,800 (corrected on screen to 15,000) opted-in contacts have never been emailed; client acknowledged.', 'proposed', 's1', 'It''s 15,000 people actually [16:52]', '2026-10-21'),
 ('lists_segments_consent', 'Pop-up changed from a single image form to a quiz (bloat / skin / hair) about 1.5 months before Sept 17; audit says it converts about double.', 'proposed', 's1', 'performing double than the other one [22:54]', '2026-11-07'),
 -- constraints
 ('constraints_rules', 'Chargebacks were 6% in March and 1.09% last month (threshold 1%), concentrated on Hotmail addresses tied to a reseller; Hotmail orders are routinely flagged or cancelled.', 'proposed', 's1', 'all those emails are under Hotmail [13:49]', '2027-01-15'),
 ('constraints_rules', 'Subscriptions are not live on the site until the CRO sprint ends (about two weeks from 2026-10-05); do not promote subscription until confirmed.', 'proposed', 's2', 'in like two weeks subscriptions on the website will be live too. Yes. [24:16]', '2026-10-21'),
 ('constraints_rules', 'Client sensitivity to over-sending: a 3-week gap followed by one send converted best, but more sends are fine around launches, bundles, and Black Friday.', 'proposed', 's1', 'too much email can hurt [28:39]', '2027-01-15'),
 ('constraints_rules', 'DMARC was moved to quarantine on the client''s DNS; email preference and unsubscribe pages are being moved to an Atrakt domain (ClickUp, awaiting client).', 'proposed', 's3', 'DMARC Moved to Quarantine (Their DNS); DNS Access task', '2026-10-21'),
 -- assets
 ('assets_references', 'Client has photo shoots, 3D renders (sleep gummy included), and the incumbent agency''s Figma file; limited assets overall; all promised to Wavy on 2026-10-05.', 'proposed', 's2', 'I''ll send over all of, like, our photo shoots, whatever assets I do have from, like, 3D renders [26:58]', '2026-10-21'),
 ('assets_references', 'Rebrand guidelines and shoot files not yet received (ClickUp task open).', 'proposed', 's3', 'Rebrand Guidelines + Shoot Files — status to do', '2026-10-21')
) v(cat, stmt, st, srckey, quote, due)
cross join lateral (select case srckey when 's1' then s1 when 's2' then s2 when 's3' then s3 when 's4' then s4 else s5 end as src) x;

-- ---------- Klaviyo flow inventory (read 2026-10-07) ----------
insert into public.flows (client_id, external_id, name, trigger_type, external_status, archived, last_synced_at) values
 ('10000000-0000-4000-8000-000000000001', 'VjzG3F', 'SE - Welcome Series', 'Added to List', 'live', false, '2026-10-07T00:00:00Z'),
 ('10000000-0000-4000-8000-000000000001', 'XjTEvB', 'SE - Welcome Series SMS List', 'Added to List', 'live', false, '2026-10-07T00:00:00Z'),
 ('10000000-0000-4000-8000-000000000001', 'SE6Dg2', 'SE - Abandoned Checkout', 'Metric', 'live', false, '2026-10-07T00:00:00Z'),
 ('10000000-0000-4000-8000-000000000001', 'SBAjZd', 'SE - Browse Abandonment', 'Metric', 'live', false, '2026-10-07T00:00:00Z'),
 ('10000000-0000-4000-8000-000000000001', 'Tp9Qsw', 'SE - Purchase', 'Metric', 'live', false, '2026-10-07T00:00:00Z'),
 ('10000000-0000-4000-8000-000000000001', 'T9dmwS', 'SE - Winback', 'Metric', 'live', false, '2026-10-07T00:00:00Z'),
 ('10000000-0000-4000-8000-000000000001', 'VJwPmk', 'OneText | Track Subscribes', 'Metric', 'live', false, '2026-10-07T00:00:00Z'),
 ('10000000-0000-4000-8000-000000000001', 'Xh4VPD', 'OneText | Track Unsubscribes', 'Metric', 'live', false, '2026-10-07T00:00:00Z'),
 ('10000000-0000-4000-8000-000000000001', 'SsigLs', 'OneText | Sync Interest to shopping_goal', 'Metric', 'draft', false, '2026-10-07T00:00:00Z')
on conflict (client_id, external_id) do update set name = excluded.name, external_status = excluded.external_status, last_synced_at = excluded.last_synced_at;

-- ---------- Sept 17 audit as Proposed scores ----------
insert into public.audits (id, client_id, template_version, kind, period_start, period_end, status, scores, overall, run_by) values
 ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 1, 'onboarding', '2026-08-01', '2026-09-17', 'prefilled', '{
   "deliverability": {"score": 3, "reason": "DMARC fixed after domain swap; Hotmail opens low (fraud-linked)", "evidence_url": "https://app.fireflies.ai/view/01M2KWTYTP26W3CTNQRNVGCA2G?t=807", "set_by_kind": "user", "verified": false},
   "segmentation": {"score": 2, "reason": "10,800 to 15,000 opted-in never emailed; segments lack product conditions", "evidence_url": "https://app.fireflies.ai/view/01M2KWTYTP26W3CTNQRNVGCA2G?t=903", "set_by_kind": "user", "verified": false},
   "flows": {"score": 2, "reason": "6 live flows; flows ~9% of revenue; dead links; old-domain welcome links", "evidence_url": "https://app.fireflies.ai/view/01M2KWTYTP26W3CTNQRNVGCA2G?t=1024", "set_by_kind": "user", "verified": false},
   "campaigns": {"score": 2.5, "reason": "Scored 3 to 3.5 on the call; August gap; email ~5.5% of revenue", "evidence_url": "https://app.fireflies.ai/view/01M2KWTYTP26W3CTNQRNVGCA2G?t=1435", "set_by_kind": "user", "verified": false},
   "offers": {"score": 1, "reason": "No approved offer set; welcome offer undecided", "evidence_url": "https://app.clickup.com/t/17tnw2b37xj", "set_by_kind": "user", "verified": false},
   "brand": {"score": 2, "reason": "Ascend Labs remnants, misspellings, duplicate brand name", "evidence_url": "https://app.fireflies.ai/view/01M2KWTYTP26W3CTNQRNVGCA2G?t=1144", "set_by_kind": "user", "verified": false},
   "capture": {"score": 3, "reason": "Quiz pop-up converting about double the image form", "evidence_url": "https://app.fireflies.ai/view/01M2KWTYTP26W3CTNQRNVGCA2G?t=1359", "set_by_kind": "user", "verified": false},
   "sms": {"score": 2, "reason": "Client-run, ad hoc, out-earns email; no coordination with email", "evidence_url": "https://app.fireflies.ai/view/01M2KWTYTP26W3CTNQRNVGCA2G?t=1806", "set_by_kind": "user", "verified": false}
 }'::jsonb, 42.0, '00000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

insert into public.findings (client_id, audit_id, area, title, detail, evidence_url, severity, confidence, impact, effort, status, next_action, created_by) values
 ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'flows', 'Welcome flow links point to the old Ascend Labs domain', 'Flow was cloned to new pop-up profiles without updating links; client partially confirmed via agency message.', 'https://app.fireflies.ai/view/01M2KWTYTP26W3CTNQRNVGCA2G?t=1024', 1, 'high', 4, 1, 'new', 'Re-verify in Klaviyo flow messages; fix links or confirm incumbent fixed them', '00000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'flows', '9 live emails with dead links', 'Audit count from Sept 17; needs re-verification per message.', 'https://app.fireflies.ai/view/01M2KWTYTP26W3CTNQRNVGCA2G?t=1061', 1, 'medium', 4, 2, 'new', 'Crawl links in all live flow and campaign templates', '00000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'segmentation', '10,800 to 15,000 opted-in contacts never emailed', 'Client acknowledged. Re-engagement must be staged to protect deliverability.', 'https://app.fireflies.ai/view/01M2KWTYTP26W3CTNQRNVGCA2G?t=934', 2, 'medium', 5, 3, 'new', 'Build the never-emailed segment in Klaviyo and size it; propose a staged warm-up plan', '00000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'flows', 'No second-purchase, replenishment, back-in-stock, VIP, or sunset flows', 'Standard journey coverage missing; 30-day product cadence makes replenishment the highest-value gap.', 'https://app.fireflies.ai/view/01M2KWTYTP26W3CTNQRNVGCA2G?t=1176', 2, 'high', 5, 4, 'new', 'Prioritize second-purchase and replenishment in the rebuild backlog', '00000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'brand', 'Win-back email still says Ascend Labs; brand name duplicated; alt text outdated', 'Old-brand remnants in live templates.', 'https://app.fireflies.ai/view/01M2KWTYTP26W3CTNQRNVGCA2G?t=1144', 1, 'high', 3, 1, 'new', 'Search all templates for "Ascend" and fix', '00000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'offers', 'No approved welcome offer', 'Blocks welcome flow rebuild and any promotion copy.', 'https://app.clickup.com/t/17tnw2b37xj', 2, 'high', 4, 1, 'new', 'Get Artemi''s decision on one offer, depth, stacking', '00000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'deliverability', 'Hotmail opens low; tied to fraud/chargeback accounts', 'Sako framed as deliverability, client as fraud; may warrant a suppression rule rather than a sending fix.', 'https://app.fireflies.ai/view/01M2KWTYTP26W3CTNQRNVGCA2G?t=817', 2, 'low', 2, 2, 'new', 'Pull engagement by provider from Klaviyo; decide suppression policy with Admin', '00000000-0000-4000-8000-000000000001');

-- ---------- agent jobs ----------
insert into public.agent_jobs (client_id, job_type, schedule, enabled) values
 ('10000000-0000-4000-8000-000000000001', 'health_review', '0 6 * * *', true),
 ('10000000-0000-4000-8000-000000000001', 'flow_sync', '0 5 * * *', true),
 ('10000000-0000-4000-8000-000000000001', 'flow_logic_doc', null, true),
 ('10000000-0000-4000-8000-000000000001', 'fact_extraction', null, true),
 ('10000000-0000-4000-8000-000000000001', 'brief_draft', null, true),
 ('10000000-0000-4000-8000-000000000001', 'meeting_preread', null, true)
on conflict (client_id, job_type) do nothing;

-- ---------- first cycle (draft) ----------
insert into public.cycles (id, client_id, starts_on, ends_on, objective, status) values
 ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '2026-10-13', '2026-10-26',
  'Flow sprint weeks 2-3: document all live flows, rebuild welcome and post-purchase in draft, re-verify audit numbers from Klaviyo, close missing inputs (SOW, claims, offer, roadmap, assets).', 'draft')
on conflict (id) do nothing;

-- ---------- tasks mirrored from the open ClickUp client dependencies ----------
insert into public.tasks (client_id, title, description, owner_id, status, clickup_task_id) values
 ('10000000-0000-4000-8000-000000000001', 'Welcome Offer Decision (One Offer, Depth, Stacking)', 'Client dependency', '00000000-0000-4000-8000-000000000002', 'todo', '17tnw2b37xj'),
 ('10000000-0000-4000-8000-000000000001', 'Approved Claims List + Cert Docs', 'Client dependency', '00000000-0000-4000-8000-000000000002', 'todo', '17tnw2b37xh'),
 ('10000000-0000-4000-8000-000000000001', 'Rebrand Guidelines + Shoot Files', 'Client dependency', '00000000-0000-4000-8000-000000000002', 'todo', '17tnw2b37xk'),
 ('10000000-0000-4000-8000-000000000001', 'DMARC Moved to Quarantine (Their DNS)', 'Client dependency', '00000000-0000-4000-8000-000000000002', 'todo', '17tnw2b37xq'),
 ('10000000-0000-4000-8000-000000000001', 'DNS Access: Move Email Preference + Unsubscribe Pages to an ATRAKT Domain', 'Client dependency', '00000000-0000-4000-8000-000000000002', 'todo', '17tnw2b3xg6'),
 ('10000000-0000-4000-8000-000000000001', 'PROJECT - OneText SMS Audit', 'In progress in ClickUp', '00000000-0000-4000-8000-000000000002', 'in_progress', '17tnw2b380g')
on conflict (clickup_task_id) do nothing;
