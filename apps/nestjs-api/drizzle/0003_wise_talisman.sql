CREATE TABLE "workspace_member_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"workspace_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"accepted" boolean DEFAULT false NOT NULL,
	"token" varchar(255) NOT NULL,
	"message" text,
	"responded_at" timestamp with time zone,
	"role" smallint DEFAULT 5 NOT NULL
);
