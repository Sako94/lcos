-- SOP updates adopted from the hub audit (0006 operating model). Idempotent: updates by SOP number.

-- SOP 2: evidence class and corrections
update public.sops set version = version + 1, updated_at = now(),
  decision_rules = '["A fact without a source cannot be Verified","An edit to an Approved fact reopens it as Proposed","Meeting comments become facts only after verification against the transcript","Every fact carries an evidence class: stated, observed, inferred, modeled, or proposed","An observed, inferred, or modeled fact cannot be Verified without a metric basis (metric key, window, time basis, population) or a snapshot","A wrong fact is never edited into a right one: the correction is a new fact, the old one is superseded with a note and goes Stale"]'::jsonb,
  checklist = '["Every Approved fact has a source link and approver","No fact older than its review interval without a check","Sensitive categories approved by an admin","Every figure names its metric key from the dictionary"]'::jsonb
where number = 2;

-- SOP 3: snapshots and readouts
update public.sops set version = version + 1, updated_at = now(),
  steps = '["Pull reports; every pull is stored as a dated snapshot","Compute deltas against the prior snapshot and the audit baseline","Flag anomalies by rule","Draft findings citing the snapshot and the metric key as evidence","Account Lead confirms, dismisses with reason, or promotes with a next readout"]'::jsonb,
  decision_rules = '["Any live flow with zero sends in 7 days is a finding","Open rate drop over 20% period on period is a finding","Spam complaints above 0.08% or campaign unsubscribe above 0.5% is Severity 1 and goes to the Admin the same day","Flow placed-order rate under half its 90-day average is a finding","Revenue findings are scored impact x confidence / effort","An agent finding without a snapshot is rejected by the database","A finding is promoted only with a next readout: how and when we will know it worked","A finding that needs an input the data cannot give opens a decision with a named owner"]'::jsonb
where number = 3;

-- SOP 5: message-level checks
update public.sops set version = version + 1, updated_at = now(),
  steps = '["Sync inventory (daily) and every live message with its subject, sender and links (nightly link check)","Document trigger, filters, exclusions, timing, offer, and links per flow","Check journey coverage against the standard set (welcome, browse, cart, checkout, post-purchase, second purchase, replenishment, winback, sunset, back in stock, VIP, subscription onboarding)","Map each live flow to a step in the target journey; anything unmapped is a gap","Score each flow on performance, content, technical health","Build the rebuild backlog in priority order","Per flow: brief, Figma, copy, internal review, client approval, build as draft, Admin approves go-live"]'::jsonb,
  decision_rules = '["Never edit a live flow in place; rebuild as a new draft and cut over with a note","A link to a domain outside the client approved list, old-brand text, or an old-brand sender name is Severity 1, found nightly, and fixed immediately","One flow goes live at a time with a 7-day observation window","Findings point at the exact flow message and the HTML snapshot that shows the defect"]'::jsonb
where number = 5;

-- SOP 6: contact policy
update public.sops set version = version + 1, updated_at = now(),
  steps = '["List fixed events","Set the cycle objective","Allocate slots by purpose with a balance rule","Assign segment, audience rule, exclusions and channel per slot","Mark conditional sends as replacing their base slot","Check inventory and offer eligibility","Submit for Admin approval; the database checks the contact policy at approval","Deliver to the client two weeks ahead"]'::jsonb,
  decision_rules = '["Minimum 12 and maximum 16 campaign emails per month once fully transitioned","No promotion two sends in a row (enforced at approval)","Weekly caps per channel come from the client contact policy (enforced at approval)","A conditional offer replaces its base message in the same slot; it never adds a send","SMS reserved for drops, launches, restocks until frequency rules are approved","Campaigns never carry an offer that conflicts with a live flow offer"]'::jsonb
where number = 6;

-- SOP 7: bindings
update public.sops set version = version + 1, updated_at = now(),
  decision_rules = '["A claim appears only if it maps to an Approved claims fact","Audience language follows the audience fact unless the segment says otherwise","No discount deeper than the approved offer","Any value that must be true at send time (offer, price, product name, date) is a [[TOKEN]] bound to an Approved fact, never typed by hand"]'::jsonb
where number = 7;

-- SOP 14: design handoff written in full
update public.sops set version = version + 1, updated_at = now(), wave = 'mvp',
  trigger_text = 'Copy version approved internally; brief ready for design',
  inputs = '["Approved copy version","Brief (goal, segment, offer, key message, CTA)","Vetted assets","Design references","Delivery date"]'::jsonb,
  steps = '["Record the context: objective, audience, offer, timing","Record the approved copy version and the exact CTA destinations","Write the design direction: modules, hierarchy, mobile and dark mode notes","Name the owner, delivery date and format","Complete the ready check; release the handoff (database blocks release until every item passes)","Designer attaches the Figma link to the brief"]'::jsonb,
  decision_rules = '["No handoff without a saved copy version","Every CTA destination is on an approved domain","Placeholder imagery never leaves the handoff","An edit to copy after release reopens the brief and the handoff"]'::jsonb,
  checklist = '["Approved copy version named and frozen","Every CTA has a destination URL on an approved domain","Assets vetted and linked","Mobile hierarchy and dark mode noted","Owner and delivery date confirmed"]'::jsonb
where number = 14;

-- SOP 17: experimentation pulled forward and written
update public.sops set version = version + 1, updated_at = now(), wave = 'mvp', screen = 'Experiments',
  trigger_text = 'A promoted finding with a measurable readout; any test',
  inputs = '["Finding or hypothesis","Primary metric from the dictionary","Eligible population and control option","Readout date"]'::jsonb,
  steps = '["Propose: hypothesis, treatment, control, one primary metric, minimum sample, stop rule, readout date","Account Lead or Admin approves the design","Start: the design is predeclared and frozen","Run; do not read results before the readout date","Readout: record result and conclusion against the predeclared metric","Conclusion becomes a Proposed fact (evidence class inferred) if it changes how the account is run"]'::jsonb,
  decision_rules = '["No experiment runs without a control, a primary metric, a readout date and an approval","A predeclared design cannot be changed; abandon and propose a new one","Attributed revenue is never the primary metric for a lift claim; use the metric dictionary definition","One experiment per audience at a time unless assignments are disjoint"]'::jsonb,
  checklist = '["Hypothesis states the mechanism","Control named","Sample and stop rule set before start","Readout recorded on or after the readout date","Conclusion written in one paragraph"]'::jsonb
where number = 17;

-- SOP 18: metric dictionary pulled forward
update public.sops set version = version + 1, updated_at = now(), wave = 'mvp', screen = 'Metric dictionary',
  name = 'Metric dictionary and monthly reporting',
  purpose = 'One definition per number: time basis, source, caveat. Monthly report built only from dictionary metrics.',
  trigger_text = 'Any new number shown in the app; month end',
  inputs = '["Metric dictionary","Snapshots for the period","Targets and their gates"]'::jsonb,
  steps = '["Add or update the metric definition before the number appears anywhere","Every scorecard, finding, fact and target names its metric key","Monthly: report store revenue, attributed revenue and flow share side by side, never summed","State each number with its window and time basis once; caveats live in the dictionary","Explain drivers with snapshots as evidence; record open decisions"]'::jsonb,
  decision_rules = '["Attributed revenue is never added to store revenue","A number without a metric key is not shown to the client","Two systems disagreeing on the same metric is a definitions problem settled in the dictionary, not a judgment call"]'::jsonb,
  checklist = '["Every figure in the report maps to a metric key","Windows and time bases stated","Open decisions listed with owners"]'::jsonb
where number = 18;

-- SOP 21: targets with gates
update public.sops set version = version + 1, updated_at = now(), wave = 'phase2', screen = 'Strategy',
  purpose = 'Goal review, opportunity sizing, 30/60/90, quarterly target built as floor / record / stretch with a gate per lever.',
  steps = '["Review the objective fact and last quarter against the metric dictionary","Size opportunities from findings: impact, effort, readiness, hours","Build the target: run-rate + levers − reserve; each lever carries a gate","Admin approves the target as modeled evidence","Gates are marked passed or failed as the quarter runs; only passed levers count"]'::jsonb,
  decision_rules = '["A target is modeled, never promised; the client sees the floor, record and stretch with their gates","A lever with a failed gate is removed from the forecast, not left in","Targets are stored as modeled facts and revised with a correction note, never edited silently"]'::jsonb
where number = 21;

-- SOP 9: decision register
update public.sops set version = version + 1, updated_at = now(),
  steps = '["Agent drafts the pre-read 48 hours before","Account Lead edits","Admin sends","Meeting held","Decisions and commitments recorded within 24 hours with owner and due date","Open decisions from the register go on the agenda with their options and what they unlock","Commitments mirrored to ClickUp","Prior commitments and open decisions reconciled at the next prep"]'::jsonb,
  decision_rules = '["A decision that changes an Approved fact triggers SOP 2","A commitment without an owner cannot be saved","A decision is closed only with its outcome and who decided; silence is not a decision"]'::jsonb
where number = 9;
