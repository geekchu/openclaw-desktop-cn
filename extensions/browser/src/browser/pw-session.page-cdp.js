async function withPlaywrightPageCdpSession(page, fn) {
    const session = await page.context().newCDPSession(page);
    try {
        return await fn(session);
    }
    finally {
        await session.detach().catch(() => { });
    }
}
export async function withPageScopedCdpClient(opts) {
    return await withPlaywrightPageCdpSession(opts.page, async (session) => {
        return await opts.fn((method, params) => session.send(method, params));
    });
}
