-- Add show_catalogs flag to addons table (default false: catalogs hidden unless user opts in)
ALTER TABLE "addons" ADD COLUMN "show_catalogs" BOOLEAN NOT NULL DEFAULT false;
