CREATE TABLE "content_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"orgId" text NOT NULL,
	"key" text NOT NULL,
	"locale" text DEFAULT 'es' NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"updatedBy" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_blocks" ADD CONSTRAINT "content_blocks_orgId_organizations_id_fk" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_blocks" ADD CONSTRAINT "content_blocks_updatedBy_user_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_blocks_org_key_locale_uq" ON "content_blocks" USING btree ("orgId","key","locale");