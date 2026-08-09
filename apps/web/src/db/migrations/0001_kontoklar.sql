CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"institution" text,
	"owner" text,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"opening_balance_cents" integer DEFAULT 0 NOT NULL,
	"settlement_account_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"question" text,
	"body" text NOT NULL,
	"lane" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"month" text NOT NULL,
	"planned_cents" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_line_category_month_key" UNIQUE("category_id","month")
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid,
	"name" text NOT NULL,
	"kind" text DEFAULT 'expense' NOT NULL,
	"fixed_cost" boolean DEFAULT false NOT NULL,
	"visibility" text DEFAULT 'shared' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matcher" text NOT NULL,
	"category_id" uuid NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_rule_matcher_key" UNIQUE("matcher")
);
--> statement-breakpoint
CREATE TABLE "import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"filename" text NOT NULL,
	"parsed_rows" integer DEFAULT 0 NOT NULL,
	"imported_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"parser" text DEFAULT 'csv' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "txn" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"booked_on" date NOT NULL,
	"spent_on" date NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"counterparty" text,
	"amount_cents" integer NOT NULL,
	"category_id" uuid,
	"role" text DEFAULT 'spending' NOT NULL,
	"transfer_group" uuid,
	"settles_account_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"import_id" uuid,
	"ai_confidence" integer,
	"ai_reason" text,
	"confirmed_by_user" boolean DEFAULT false NOT NULL,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "txn_external_ref_key" UNIQUE("external_ref")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_settlement_account_id_account_id_fk" FOREIGN KEY ("settlement_account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line" ADD CONSTRAINT "budget_line_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_group_id_category_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."category_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rule" ADD CONSTRAINT "category_rule_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "txn" ADD CONSTRAINT "txn_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "txn" ADD CONSTRAINT "txn_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "txn" ADD CONSTRAINT "txn_settles_account_id_account_id_fk" FOREIGN KEY ("settles_account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_kind_idx" ON "account" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "ai_note_kind_idx" ON "ai_note" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "budget_line_month_idx" ON "budget_line" USING btree ("month");--> statement-breakpoint
CREATE INDEX "category_group_idx" ON "category" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "txn_spent_on_idx" ON "txn" USING btree ("spent_on");--> statement-breakpoint
CREATE INDEX "txn_account_idx" ON "txn" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "txn_category_idx" ON "txn" USING btree ("category_id");
