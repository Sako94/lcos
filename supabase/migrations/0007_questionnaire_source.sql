-- A client-completed onboarding questionnaire is its own kind of source.
-- Kept in its own migration: a new enum value cannot be used in the transaction that adds it.
alter type app.source_kind add value if not exists 'questionnaire';
