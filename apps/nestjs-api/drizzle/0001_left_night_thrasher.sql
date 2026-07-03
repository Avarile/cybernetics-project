CREATE TABLE "instance_admins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"user_id" uuid,
	"instance_id" uuid NOT NULL,
	"role" integer DEFAULT 20 NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"user_id" uuid NOT NULL,
	"theme" jsonb NOT NULL,
	"is_app_rail_docked" boolean DEFAULT true NOT NULL,
	"is_tour_completed" boolean DEFAULT false NOT NULL,
	"onboarding_step" jsonb NOT NULL,
	"use_case" text,
	"role" varchar(300),
	"is_onboarded" boolean DEFAULT false NOT NULL,
	"last_workspace_id" uuid,
	"billing_address_country" varchar(255) DEFAULT 'INDIA' NOT NULL,
	"billing_address" jsonb,
	"has_billing_address" boolean DEFAULT false NOT NULL,
	"company_name" varchar(255) DEFAULT '' NOT NULL,
	"notification_view_mode" varchar(255) DEFAULT 'full' NOT NULL,
	"is_smooth_cursor_enabled" boolean DEFAULT false NOT NULL,
	"is_mobile_onboarded" boolean DEFAULT false NOT NULL,
	"mobile_onboarding_step" jsonb NOT NULL,
	"mobile_timezone_auto_set" boolean DEFAULT false NOT NULL,
	"language" varchar(255) DEFAULT 'en' NOT NULL,
	"start_of_the_week" smallint DEFAULT 0 NOT NULL,
	"goals" jsonb NOT NULL,
	"background_color" varchar(255) DEFAULT '#3f76ff' NOT NULL,
	"is_navigation_tour_completed" boolean DEFAULT false NOT NULL,
	"has_marketing_email_consent" boolean DEFAULT false NOT NULL,
	"is_subscribed_to_changelog" boolean DEFAULT false NOT NULL,
	"product_tour" jsonb NOT NULL,
	CONSTRAINT "profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "instance_configurations" ADD CONSTRAINT "instance_configurations_key_unique" UNIQUE("key");--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_instance_id_unique" UNIQUE("instance_id");