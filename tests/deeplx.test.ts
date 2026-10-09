import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import deeplx, {
    getDeepLXRequestLanguages,
} from "@/src/providers/translation/deeplx";
import {DEFAULT_DEEPLX_ENDPOINT, getDeepLXEndpoints} from '@/src/core/config/deeplx';
import {providerRequest, resolvedService} from './fixtures/translationService';

function translate(endpoint = "", apiKey = "") {
    return deeplx(providerRequest(resolvedService("deeplx", {endpoint}, {apiKey}), {origin: "Hello"}));
}

const TOKEN_ENDPOINT = 'https://freeapi.fanyimao.cn/translate?token={{apiKey}}';

const fetchMock = vi.fn<typeof fetch>();

function mockResponse(body: unknown, overrides: Partial<Response> = {}): Response {
    return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: vi.fn().mockResolvedValue(JSON.stringify(body)),
        ...overrides,
    } as unknown as Response;
}

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("DeepLX endpoint configuration", () => {
    it("uses the verified public endpoint when no URL is configured", () => {
        expect(getDeepLXEndpoints("")).toEqual([DEFAULT_DEEPLX_ENDPOINT]);
    });

    it("parses comma- and newline-separated URLs", () => {
        expect(getDeepLXEndpoints("https://one.example/translate,\nhttps://two.example/translate"))
            .toEqual(["https://one.example/translate", "https://two.example/translate"]);
    });

    it("resolves token placeholders without returning a secret in the configured URL", () => {
        expect(getDeepLXEndpoints(TOKEN_ENDPOINT, "site-token"))
            .toEqual(["https://freeapi.fanyimao.cn/translate?token=site-token"]);
        expect(getDeepLXEndpoints('https://api.deeplx.org/{{apiKey}}/translate', ""))
            .toEqual([DEFAULT_DEEPLX_ENDPOINT]);
    });
});

describe("DeepLX adapter", () => {
    it("sends the expected request and parses a successful response", async () => {
        fetchMock.mockResolvedValue(mockResponse({code: 200, data: "你好"}));

        await expect(translate()).resolves.toBe("你好");

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toBe(DEFAULT_DEEPLX_ENDPOINT);
        expect(init).toMatchObject({method: "POST"});
        expect(init?.headers).toEqual({"Content-Type": "application/json"});
        expect(JSON.parse(String(init?.body))).toEqual({
            text: "Hello",
            source_lang: "AUTO",
            target_lang: "ZH",
        });
    });

    it("falls back to the next configured URL after an HTTP failure", async () => {
        fetchMock
            .mockResolvedValueOnce(mockResponse({message: "busy"}, {
                ok: false,
                status: 503,
                statusText: "Service Unavailable",
                text: vi.fn().mockResolvedValue("busy"),
            }))
            .mockResolvedValueOnce(mockResponse({code: 200, data: "备用译文"}));

        await expect(translate("https://primary.example/translate,\nhttps://backup.example/translate")).resolves.toBe("备用译文");
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1]?.[0]).toBe("https://backup.example/translate");
    });

    it("falls back after an invalid DeepLX response", async () => {
        fetchMock
            .mockResolvedValueOnce(mockResponse({code: 200, data: ""}))
            .mockResolvedValueOnce(mockResponse({code: 200, data: "有效译文"}));

        await expect(translate("https://invalid.example/translate,https://valid.example/translate")).resolves.toBe("有效译文");
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("adds an optional bearer token without exposing it in the URL", async () => {
        fetchMock.mockResolvedValue(mockResponse({code: 200, data: "你好"}));

        await translate("", "test-token");

        expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
            "Content-Type": "application/json",
            Authorization: "Bearer test-token",
        });
    });

    it("supports a token placeholder in a preset endpoint", async () => {
        fetchMock.mockResolvedValue(mockResponse({code: 200, data: "你好"}));

        await expect(translate(TOKEN_ENDPOINT, "site-token")).resolves.toBe("你好");

        expect(fetchMock.mock.calls[0]?.[0]).toBe("https://freeapi.fanyimao.cn/translate?token=site-token");
    });

    it("normalizes Chinese language variants", () => {
        expect(getDeepLXRequestLanguages("auto", "zh-Hans")).toEqual({
            sourceLang: "AUTO",
            targetLang: "ZH",
        });
        expect(getDeepLXRequestLanguages("zh-TW", "en")).toEqual({
            sourceLang: "ZH-HANT",
            targetLang: "EN",
        });
    });
});
