import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CookieTestPanel } from "@/components/admin/CookieTestPanel";

describe("CookieTestPanel", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("compares QR login and manual Cookie acquisition paths", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/login/diagnostics") {
        return new Response(JSON.stringify({ configured: false, valid: false, cookiePreview: "", account: null }));
      }
      if (url === "/api/login/qr?force=1") {
        return new Response(JSON.stringify({ key: "qr-key", qrUrl: "data:image/png;base64,abc" }));
      }
      if (url === "/api/login/status?key=qr-key&force=1") {
        return new Response(JSON.stringify({ status: "authorized", source: "qr", encryptedCookie: "local-dev:abc" }));
      }
      if (url === "/api/login/cookie") {
        expect(JSON.parse(String(init?.body))).toEqual({ cookie: "MUSIC_U=manual-cookie" });
        return new Response(JSON.stringify({ ok: true, status: "authorized", source: "cookie" }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<CookieTestPanel />);

    expect(await screen.findByText("未配置")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "生成二维码" }));
    expect(await screen.findByAltText("网易云二维码登录")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "检查扫码状态" }));
    expect(await screen.findByText("二维码已授权，接口返回了登录凭据。")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "网易云 Cookie" }), { target: { value: "MUSIC_U=manual-cookie" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并校验 Cookie" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/login/cookie",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ cookie: "MUSIC_U=manual-cookie" })
        })
      );
    });
    expect(await screen.findByText("手动 Cookie 已保存。")).toBeInTheDocument();
  });

  it("polls QR login status automatically after generating a code", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/login/diagnostics") {
        return new Response(JSON.stringify({ configured: false, valid: false, cookiePreview: "", account: null }));
      }
      if (url === "/api/login/qr?force=1") {
        return new Response(JSON.stringify({ key: "qr-key", qrUrl: "data:image/png;base64,abc" }));
      }
      if (url === "/api/login/status?key=qr-key&force=1") {
        return new Response(JSON.stringify({ status: "authorized", source: "qr", encryptedCookie: "local-dev:abc" }));
      }
      return new Response(JSON.stringify({ ok: true }));
    });

    render(<CookieTestPanel />);

    expect(await screen.findByText("未配置")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "生成二维码" }));
    expect(await screen.findByAltText("网易云二维码登录")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });

    expect(await screen.findByText("二维码已授权，接口返回了登录凭据。")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/login/status?key=qr-key&force=1");
  });

  it("does not render the full manually pasted Cookie outside the input", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/login/diagnostics") {
        return new Response(JSON.stringify({ configured: false, valid: false, cookiePreview: "", account: null }));
      }
      return new Response(JSON.stringify({ ok: true }));
    });

    render(<CookieTestPanel />);

    await screen.findByRole("textbox", { name: /Cookie/ });
    const token = "MUSIC_U=manual-cookie-secret-token";
    fireEvent.change(screen.getByRole("textbox", { name: /Cookie/ }), { target: { value: token } });

    const renderedOutsideInput = Array.from(document.body.querySelectorAll("span, p, strong, button"))
      .map((node) => node.textContent ?? "")
      .join("\n");
    expect(renderedOutsideInput).not.toContain(token);
  });
});
