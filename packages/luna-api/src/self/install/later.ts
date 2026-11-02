import { installPackages, type PackageRecipe } from "./packages.ts";
import type { InstallContext } from "./command.ts";

export function installLaterPackages(context: InstallContext, recipes: PackageRecipe[]) {
  return installPackages(context, recipes);
}
