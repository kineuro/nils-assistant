# rater: the blind read of a raters' campaign

The rater of site participation (Wave 7b step 5): the model-first path of a site's sealed read, so a site needs
nothing outside its install. It is not a chat station. The desk starts it through `POST /raters/runs {campaign,
model?, thinking?}` and follows it through `GET /raters/runs/{id}`; it has no conversation a person writes in.

What one run does, for every item the campaign offers it:

1. Claims the next item as a rater (`POST /api/campaigns/{id}/claim {"role": "rater"}`).
2. Reads the item's why (`GET .../items/{item}/why`). It must say `blind: true`; otherwise the lease is given back
   and the run refuses, saying so. The rater reads only a campaign made to suggest none.
3. Reads the item's header (`GET .../items/{item}/header`): header text, never a system's answer.
4. Builds certificate 2's packet from the header and the why (texts, sequence, physics, geometry, the private
   elements the pack shows, the session). A packet that holds an identifier key or a personnummer-shaped text is
   refused before anything is sent, and the item is answered can't tell on every axis.
5. Asks the model once, with thinking on by default, under the registered header-judge prompt (v3.4) whose
   per-axis value lists are the campaign's own `question.values` and meanings; the answer is constrained to the
   registered schema, widened by the campaign's values. An answer that breaks the pack's constraints is asked
   again once.
6. Answers the campaign on every asked axis (`POST .../assignments/{a}/answer`): the model's value read through
   the question's `earlier_names`, a value the question does not offer becoming can't tell, counted.

It reads as the person who started it, with that person's token, so that person is the draw's rater and may not
settle. It keeps and logs counts only: never header text, a subject code, a stack id or a path.
