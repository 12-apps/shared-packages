-- Which language a person reads, as a table this package owns.
--
-- The copy resolvers shipped first and nothing could answer them: a
-- notification blueprint and the four auth mails both ask for the recipient's
-- tag at the moment they render, and the only place a host kept a language was
-- the browser's localStorage plus a cookie. That is THIS DEVICE's preference —
-- it does not follow the person to their phone, and it is not in the room at
-- all when a background job writes to them. So every notice resolved to the
-- default: the mechanism was complete and the fact was missing.
--
-- A TABLE and not a column on the host's users, for the reason auth.prisma
-- already states about its three credential columns: a package cannot add a
-- column to a table it does not own, and `user_id` carries NO foreign key, so
-- this applies to a repo whose user table is named something else, lives in
-- another database, or does not exist yet at migrate time.
--
-- A row EXISTS only once somebody has chosen. There is no default and no
-- backfill: absence is how "has not chosen" is said, and it is a different fact
-- from "reads pt-BR". Collapsing them would make a guess indistinguishable from
-- a choice — and since a reader's own setting outranks the tenant's, that guess
-- would then beat a store language nobody had a chance to lose to.
CREATE TABLE "locale_preferences" (
    "user_id"    TEXT NOT NULL,
    "locale"     TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locale_preferences_pkey" PRIMARY KEY ("user_id")
);
