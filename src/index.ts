import { readFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { X509Certificate } from '@peculiar/x509';
import { type Plugin } from "vite";

interface UserConfig {
	enable?: boolean | (() => boolean);
	domain: string;
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
		}
	}
}

function parseUserConfig(userConfig: Partial<UserConfig>): UserConfig {
	userConfig.enable ??= true;

	return userConfig as UserConfig;
}

function extractFilenameHash(filename: string): string | null {
	const name = basename(filename, ".crt");
	const parts = name.split("_");

	// Heuristic: domain parts are usually alphabetic, hash parts include hex/numbers
	let boundaryIndex = parts.findIndex((part: string) => /[0-9a-f]{4,}/i.test(part));
	if (boundaryIndex === -1) return null;

	const uniqueParts = parts.slice(boundaryIndex, boundaryIndex + 2).join("_");
	return uniqueParts;
}

function processCertFiles(certFile: CertificateFile): ProcessedCertificateFile {
	const cert = new X509Certificate(certFile.contents);
	const dnsNames = cert.extensions
		.find(ext => ext.type === '2.5.29.17')
		?.toString() ?? ""
  	const parsedDomainResults = dnsNames.matchAll(/^\s+DNS:([\w\.\s]+)$/gm);
	const parsedDomains = Array.from(parsedDomainResults).map(dom => dom.at(-1)?.trim()).filter(item => typeof item !== "undefined")

	const processedCertFile: ProcessedCertificateFile = {
		path: certFile.path,
		contents: {
			parsed: {
				is_self_signed: cert.subject === cert.issuer,
				domains: parsedDomains,
				not_after: new Date(cert.notAfter)
			}
		}
	}

	return processedCertFile;
}

export default function vitePluginCPanelSsl(userConfig: Partial<UserConfig> = {}): Plugin {
	userConfig = parseUserConfig(userConfig);
	return {
		name: "vite-plugin-cpanel-ssl",
		config: async (config, env) => {
			if (env.mode === "production" || userConfig.enable !== true) return;

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
							(!userConfig.domain || contents.parsed.domains.includes(userConfig.domain))
						);
					});
				})
				.then((certFiles) => certFiles[0]?.path)
				.catch(err => {
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
				config.server.host = userConfig.domain;
			}
		},
	};
}
