import "reflect-metadata";
import { readFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { SubjectAlternativeNameExtension, X509Certificate } from "@peculiar/x509";
import { type Plugin } from "vite";

interface UserConfig {
	enable?: boolean | (() => boolean);
	domain: string;
	allowedIps: string[];
}

interface CertificateFile {
	path: string;
	contents: string;
}

interface ProcessedCertificateFile {
	path: string;
	contents: {
		parsed: {
			not_after: Date;
			domains: string[];
			is_self_signed: boolean;
		};
	};
}

function parseUserConfig(userConfig: Partial<UserConfig>): UserConfig {
	const resolvedConfig = { ...userConfig };
	resolvedConfig.enable ??= true;
	resolvedConfig.allowedIps ??= [];

	return resolvedConfig as UserConfig;
}

function extractFilenameHash(filename: string): string | null {
	const name = basename(filename, ".crt");

	// cPanel names certs <domain>_<hex>_<hex>_<timestamp>_<hash>, and the key starts with the <hex>_<hex> pair.
	// Match from the end so hex-looking domain parts (e.g. "cafe_com") aren't mistaken for the pair.
	const match = name.match(/_([0-9a-f]+_[0-9a-f]+)_\d+_[0-9a-f]+$/i);
	return match?.[1] ?? null;
}

function domainMatches(san: string, domain: string): boolean {
	san = san.toLowerCase();
	domain = domain.toLowerCase();
	if (san === domain) return true;

	// A wildcard covers exactly one label, so *.example.com matches dev.example.com but not example.com or a.b.example.com
	if (!san.startsWith("*.")) return false;
	const firstDot = domain.indexOf(".");
	return firstDot > 0 && domain.slice(firstDot) === san.slice(1);
}

function processCertFiles(certFile: CertificateFile): ProcessedCertificateFile {
	const cert = new X509Certificate(certFile.contents);
	const parsedDomains =
		cert
			.getExtension(SubjectAlternativeNameExtension)
			?.names.items.filter((name) => name.type === "dns")
			.map((name) => name.value) ?? [];

	const processedCertFile: ProcessedCertificateFile = {
		path: certFile.path,
		contents: {
			parsed: {
				is_self_signed: cert.subject === cert.issuer,
				domains: parsedDomains,
				not_after: new Date(cert.notAfter),
			},
		},
	};

	return processedCertFile;
}

export default function vitePluginCPanelSsl(userConfig: Partial<UserConfig> = {}): Plugin {
	const resolvedConfig = parseUserConfig(userConfig);
	return {
		name: "vite-plugin-cpanel-ssl",
		config: async (config, env) => {
			const isEnabled =
				typeof resolvedConfig.enable === "function" ? resolvedConfig.enable() : resolvedConfig.enable;
			if (env.mode === "production" || isEnabled !== true) return;

			const homeDir = process.env.HOME;
			if (!homeDir) {
				console.log("[cPanelSSL]: Couldn't find home directory from process");
				return;
			}

			const certsDir = join(homeDir, "ssl", "certs");
			const keysDir = join(homeDir, "ssl", "keys");
			const certsList = (await readdir(certsDir)).filter((filename) => filename.endsWith(".crt"));
			const certFile = await Promise.all(
				certsList.map((cert: string) => {
					return readFile(join(certsDir, cert), "utf-8").then((contents) => ({
						path: join(certsDir, cert),
						contents: contents,
					}));
				}),
			)
				.then((certFiles) => {
					return certFiles.map(processCertFiles).filter(({ contents }) => {
						const data = contents.parsed;
						return (
							data.not_after >= new Date() &&
							!data.is_self_signed &&
							(!resolvedConfig.domain ||
								data.domains.some((san) => domainMatches(san, resolvedConfig.domain)))
						);
					});
				})
				.then((certFiles) => certFiles[0]?.path)
				.catch((err) => {
					console.error(err);
					return null;
				});

			if (!certFile) {
				console.log("[cPanelSSL]: Unable to find valid cert file");
				return;
			}

			const hash = extractFilenameHash(certFile);
			if (!hash) {
				console.log("[cPanelSSL]: Couldn't extract hash from certificate filename");
				return;
			}

			const keyFile = (await readdir(keysDir)).find((keyfile) => keyfile.startsWith(hash));
			if (!keyFile) {
				console.log("[cPanelSSL]: Couldn't find key file");
				return;
			}

			config.server ??= {};

			const files = await Promise.all([readFile(certFile, "utf-8"), readFile(join(keysDir, keyFile), "utf-8")]);
			if (!files || files.length !== 2) {
				console.log("[cPanelSSL]: Couldn't load key/cert files");
				return;
			}

			config.server.https = {
				cert: files[0],
				key: files[1],
			};

			if (!config.server.host) {
				config.server.host = resolvedConfig.domain;
			}
		},
		configureServer(server) {
			if (!resolvedConfig.allowedIps.length) {
				return;
			}

			server.httpServer?.on("connection", (socket) => {
				const ip = socket.remoteAddress?.replace(/^::ffff:/, "");
				if (!ip || !resolvedConfig.allowedIps.includes(ip)) {
					server.config.logger.info(`[cPanel SSL] Rejected connection from ${ip}`);
					socket.destroy();
				}
			});
		},
	};
}
