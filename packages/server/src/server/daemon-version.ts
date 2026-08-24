import { PackageVersionResolutionError, resolvePackageVersion } from "./package-version.js";

const SERVER_PACKAGE_NAME = "@getpaseo/server";

export class DaemonVersionResolutionError extends PackageVersionResolutionError {}

export function resolveDaemonVersion(moduleUrl: string = import.meta.url): string {
  if (process.env.PASEO_DAEMON_VERSION) {
    return process.env.PASEO_DAEMON_VERSION;
  }
  if (process.env.npm_package_version) {
    return process.env.npm_package_version;
  }
  try {
    return resolvePackageVersion({
      moduleUrl,
      packageName: SERVER_PACKAGE_NAME,
    });
  } catch (error) {
    if (error instanceof PackageVersionResolutionError) {
      throw new DaemonVersionResolutionError({
        moduleUrl,
        packageName: SERVER_PACKAGE_NAME,
      });
    }
    throw error;
  }
}
