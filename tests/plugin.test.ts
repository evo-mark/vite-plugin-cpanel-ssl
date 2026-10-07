import "reflect-metadata";
import type { webcrypto } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PemConverter, SubjectAlternativeNameExtension, X509CertificateGenerator } from "@peculiar/x509";
import type { ConfigEnv, Plugin, UserConfig as ViteConfig, ViteDevServer } from "vite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import vitePluginCPanelSsl from "../src/index.js";

const alg = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;
const DAY = 24 * 60 * 60 * 1000;

const serveEnv: ConfigEnv = { command: "serve", mode: "development" };

let caKeys: webcrypto.CryptoKeyPair;
let homeDir: string;
let serial = 1;

interface CertOptions {
	domains: string[];
	selfSigned?: boolean;
	notAfter?: Date;
}

async function createCert({ domains, selfSigned = false, notAfter = new Date(Date.now() + 90 * DAY) }: CertOptions) {
	const keys = await crypto.subtle.generateKey(alg, true, ["sign", "verify"]);
	const extensions = [
		new SubjectAlternativeNameExtension(domains.map((value) => ({ type: "dns" as const, value }))),
	];
	const common = {
		serialNumber: String(serial++).padStart(2, "0"),
		name: `CN=${domains[0]}`,
		notBefore: new Date(notAfter.getTime() - 365 * DAY),
		notAfter,
		signingAlgorithm: alg,
		extensions,
	};

	const cert = selfSigned
		? await X509CertificateGenerator.createSelfSigned({ ...common, keys })
		: await X509CertificateGenerator.create({
				...common,
				subject: common.name,
				issuer: "CN=Test CA",
				publicKey: keys.publicKey,
				signingKey: caKeys.privateKey,
			});

	const pkcs8 = await crypto.subtle.exportKey("pkcs8", keys.privateKey);
	return {
		cert: cert.toString("pem"),
		key: PemConverter.encode(pkcs8, "PRIVATE KEY"),
	};
}

/** Writes a cert/key pair using cPanel's naming scheme, e.g. example_com_a1b2c_d3e4f_1767225600_<hash>.crt */
async function installCert(options: CertOptions & { hash: string }) {
	const { cert, key } = await createCert(options);
	const domainPart = options.domains[0].replaceAll(".", "_");
	const certPath = join(homeDir, "ssl", "certs", `${domainPart}_${options.hash}_1767225600_0123456789.crt`);
	await writeFile(certPath, cert);
	await writeFile(join(homeDir, "ssl", "keys", `${options.hash}_0123456789abcdef.key`), key);
	return { certPath, cert, key };
}

async function runConfigHook(plugin: Plugin, config: ViteConfig = {}, env: ConfigEnv = serveEnv) {
	const hook = plugin.config as (config: ViteConfig, env: ConfigEnv) => Promise<void>;
	await hook(config, env);
	return config;
}

beforeAll(async () => {
	caKeys = await crypto.subtle.generateKey(alg, true, ["sign", "verify"]);
});

beforeEach(async () => {
	homeDir = await mkdtemp(join(tmpdir(), "cpanel-ssl-"));
	await mkdir(join(homeDir, "ssl", "certs"), { recursive: true });
	await mkdir(join(homeDir, "ssl", "keys"), { recursive: true });
	vi.stubEnv("HOME", homeDir);
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	await rm(homeDir, { recursive: true, force: true });
});

describe("config hook", () => {
	it("sets the https cert/key and host from a matching certificate", async () => {
		const { cert, key } = await installCert({ domains: ["example.com", "www.example.com"], hash: "a1b2c_d3e4f" });

		const config = await runConfigHook(vitePluginCPanelSsl({ domain: "example.com" }));

		expect(config.server?.https).toEqual({ cert, key });
		expect(config.server?.host).toBe("example.com");
	});

	it("matches the domain against any SAN entry", async () => {
		const { cert } = await installCert({ domains: ["example.com", "dev.example.com"], hash: "a1b2c_d3e4f" });

		const config = await runConfigHook(vitePluginCPanelSsl({ domain: "dev.example.com" }));

		expect(config.server?.https).toMatchObject({ cert });
	});

	it("matches domains containing hyphens", async () => {
		const { cert } = await installCert({ domains: ["my-site.com"], hash: "a1b2c_d3e4f" });

		const config = await runConfigHook(vitePluginCPanelSsl({ domain: "my-site.com" }));

		expect(config.server?.https).toMatchObject({ cert });
	});

	it("matches domains case-insensitively", async () => {
		const { cert } = await installCert({ domains: ["example.com"], hash: "a1b2c_d3e4f" });

		const config = await runConfigHook(vitePluginCPanelSsl({ domain: "Example.COM" }));

		expect(config.server?.https).toMatchObject({ cert });
	});

	it.each(["cafe.com", "feedback.example.com", "decaf.com", "beef.dead.com"])(
		"finds the key for hex-looking domain %s",
		async (domain) => {
			const { cert, key } = await installCert({ domains: [domain], hash: "a1b2c_d3e4f" });

			const config = await runConfigHook(vitePluginCPanelSsl({ domain }));

			expect(config.server?.https).toEqual({ cert, key });
		},
	);

	describe("wildcard certificates", () => {
		it("matches a single-label subdomain", async () => {
			const { cert } = await installCert({ domains: ["example.com", "*.example.com"], hash: "a1b2c_d3e4f" });

			const config = await runConfigHook(vitePluginCPanelSsl({ domain: "dev.example.com" }));

			expect(config.server?.https).toMatchObject({ cert });
			expect(config.server?.host).toBe("dev.example.com");
		});

		it("matches the wildcard name itself", async () => {
			const { cert } = await installCert({ domains: ["*.example.com"], hash: "a1b2c_d3e4f" });

			const config = await runConfigHook(vitePluginCPanelSsl({ domain: "*.example.com" }));

			expect(config.server?.https).toMatchObject({ cert });
		});

		it.each(["example.com", "a.b.example.com", "dev.other.com", "devexample.com"])(
			"does not match %s",
			async (domain) => {
				await installCert({ domains: ["*.example.com"], hash: "a1b2c_d3e4f" });

				const config = await runConfigHook(vitePluginCPanelSsl({ domain }));

				expect(config.server).toBeUndefined();
			},
		);
	});

	it("picks the certificate for the configured domain when several exist", async () => {
		await installCert({ domains: ["other.com"], hash: "aaaa1_bbbb1" });
		const { cert, key } = await installCert({ domains: ["example.com"], hash: "cccc2_dddd2" });

		const config = await runConfigHook(vitePluginCPanelSsl({ domain: "example.com" }));

		expect(config.server?.https).toEqual({ cert, key });
	});

	it("uses the first valid certificate when no domain is configured", async () => {
		const { cert } = await installCert({ domains: ["example.com"], hash: "a1b2c_d3e4f" });

		const config = await runConfigHook(vitePluginCPanelSsl());

		expect(config.server?.https).toMatchObject({ cert });
		expect(config.server?.host).toBeUndefined();
	});

	it("does not override an existing server.host", async () => {
		await installCert({ domains: ["example.com"], hash: "a1b2c_d3e4f" });

		const config = await runConfigHook(vitePluginCPanelSsl({ domain: "example.com" }), {
			server: { host: "0.0.0.0" },
		});

		expect(config.server?.host).toBe("0.0.0.0");
		expect(config.server?.https).toBeDefined();
	});

	it("skips expired certificates", async () => {
		await installCert({ domains: ["example.com"], hash: "a1b2c_d3e4f", notAfter: new Date(Date.now() - DAY) });

		const config = await runConfigHook(vitePluginCPanelSsl({ domain: "example.com" }));

		expect(config.server).toBeUndefined();
		expect(console.log).toHaveBeenCalledWith("[cPanelSSL]: Unable to find valid cert file");
	});

	it("skips self-signed certificates", async () => {
		await installCert({ domains: ["example.com"], hash: "a1b2c_d3e4f", selfSigned: true });

		const config = await runConfigHook(vitePluginCPanelSsl({ domain: "example.com" }));

		expect(config.server).toBeUndefined();
	});

	it("prefers a valid certificate over expired and self-signed ones", async () => {
		await installCert({ domains: ["example.com"], hash: "aaaa1_bbbb1", notAfter: new Date(Date.now() - DAY) });
		await installCert({ domains: ["example.com"], hash: "cccc2_dddd2", selfSigned: true });
		const { cert } = await installCert({ domains: ["example.com"], hash: "eeee3_ffff3" });

		const config = await runConfigHook(vitePluginCPanelSsl({ domain: "example.com" }));

		expect(config.server?.https).toMatchObject({ cert });
	});

	it("does nothing when no certificate matches the domain", async () => {
		await installCert({ domains: ["other.com"], hash: "a1b2c_d3e4f" });

		const config = await runConfigHook(vitePluginCPanelSsl({ domain: "example.com" }));

		expect(config.server).toBeUndefined();
	});

	it("ignores files that are not .crt", async () => {
		const { cert } = await createCert({ domains: ["example.com"] });
		await writeFile(join(homeDir, "ssl", "certs", "example_com_a1b2c_d3e4f.pem"), cert);

		const config = await runConfigHook(vitePluginCPanelSsl({ domain: "example.com" }));

		expect(config.server).toBeUndefined();
	});

	it("does nothing when the matching key file is missing", async () => {
		await installCert({ domains: ["example.com"], hash: "a1b2c_d3e4f" });
		await rm(join(homeDir, "ssl", "keys", "a1b2c_d3e4f_0123456789abcdef.key"));

		const config = await runConfigHook(vitePluginCPanelSsl({ domain: "example.com" }));

		expect(config.server?.https).toBeUndefined();
		expect(console.log).toHaveBeenCalledWith("[cPanelSSL]: Couldn't find key file");
	});

	it("does nothing when the cert filename has no hash segment", async () => {
		const { cert } = await createCert({ domains: ["example.com"] });
		await writeFile(join(homeDir, "ssl", "certs", "example_com.crt"), cert);

		const config = await runConfigHook(vitePluginCPanelSsl({ domain: "example.com" }));

		expect(config.server).toBeUndefined();
		expect(console.log).toHaveBeenCalledWith("[cPanelSSL]: Couldn't extract hash from certificate filename");
	});

	it("logs and does nothing when a cert file cannot be parsed", async () => {
		await writeFile(join(homeDir, "ssl", "certs", "example_com_a1b2c_d3e4f.crt"), "not a certificate");

		const config = await runConfigHook(vitePluginCPanelSsl({ domain: "example.com" }));

		expect(config.server).toBeUndefined();
		expect(console.error).toHaveBeenCalled();
	});

	it("does nothing when HOME is not set", async () => {
		vi.stubEnv("HOME", undefined);

		const config = await runConfigHook(vitePluginCPanelSsl({ domain: "example.com" }));

		expect(config.server).toBeUndefined();
		expect(console.log).toHaveBeenCalledWith("[cPanelSSL]: Couldn't find home directory from process");
	});

	describe("enabling", () => {
		beforeEach(async () => {
			await installCert({ domains: ["example.com"], hash: "a1b2c_d3e4f" });
		});

		it("does nothing in production mode", async () => {
			const config = await runConfigHook(vitePluginCPanelSsl({ domain: "example.com" }), {}, {
				command: "build",
				mode: "production",
			});

			expect(config.server).toBeUndefined();
		});

		it("does nothing when enable is false", async () => {
			const config = await runConfigHook(vitePluginCPanelSsl({ domain: "example.com", enable: false }));

			expect(config.server).toBeUndefined();
		});

		it("resolves enable when it is a function", async () => {
			const enable = vi.fn(() => true);

			const config = await runConfigHook(vitePluginCPanelSsl({ domain: "example.com", enable }));

			expect(enable).toHaveBeenCalled();
			expect(config.server?.https).toBeDefined();
		});

		it("does nothing when enable is a function returning false", async () => {
			const config = await runConfigHook(vitePluginCPanelSsl({ domain: "example.com", enable: () => false }));

			expect(config.server).toBeUndefined();
		});
	});
});

describe("configureServer hook", () => {
	function createServer() {
		const httpServer = new EventEmitter();
		const info = vi.fn();
		const server = { httpServer, config: { logger: { info } } } as unknown as ViteDevServer;
		return { server, httpServer, info };
	}

	function connect(httpServer: EventEmitter, remoteAddress: string | undefined) {
		const socket = { remoteAddress, destroy: vi.fn() };
		httpServer.emit("connection", socket);
		return socket;
	}

	function configureServer(plugin: Plugin, server: ViteDevServer) {
		(plugin.configureServer as (server: ViteDevServer) => void)(server);
	}

	it("does not add a listener when no IPs are allowed", () => {
		const { server, httpServer } = createServer();

		configureServer(vitePluginCPanelSsl(), server);

		expect(httpServer.listenerCount("connection")).toBe(0);
	});

	it("allows connections from listed IPs", () => {
		const { server, httpServer, info } = createServer();
		configureServer(vitePluginCPanelSsl({ allowedIps: ["203.0.113.5"] }), server);

		const socket = connect(httpServer, "203.0.113.5");

		expect(socket.destroy).not.toHaveBeenCalled();
		expect(info).not.toHaveBeenCalled();
	});

	it("allows IPv4-mapped IPv6 addresses of listed IPs", () => {
		const { server, httpServer } = createServer();
		configureServer(vitePluginCPanelSsl({ allowedIps: ["203.0.113.5"] }), server);

		const socket = connect(httpServer, "::ffff:203.0.113.5");

		expect(socket.destroy).not.toHaveBeenCalled();
	});

	it("rejects and logs connections from unlisted IPs", () => {
		const { server, httpServer, info } = createServer();
		configureServer(vitePluginCPanelSsl({ allowedIps: ["203.0.113.5"] }), server);

		const socket = connect(httpServer, "198.51.100.7");

		expect(socket.destroy).toHaveBeenCalled();
		expect(info).toHaveBeenCalledWith("[cPanel SSL] Rejected connection from 198.51.100.7");
	});

	it("rejects connections with no remote address", () => {
		const { server, httpServer } = createServer();
		configureServer(vitePluginCPanelSsl({ allowedIps: ["203.0.113.5"] }), server);

		const socket = connect(httpServer, undefined);

		expect(socket.destroy).toHaveBeenCalled();
	});

	it("handles a server without an httpServer (middleware mode)", () => {
		const server = { httpServer: null } as unknown as ViteDevServer;

		expect(() => configureServer(vitePluginCPanelSsl({ allowedIps: ["203.0.113.5"] }), server)).not.toThrow();
	});
});
