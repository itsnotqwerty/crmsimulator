const STYLESHEET_URL = new URL("../../static/crm.css", import.meta.url);

export async function stylesheetResponse(): Promise<Response> {
  const stylesheet = await Deno.readFile(STYLESHEET_URL);

  return new Response(stylesheet, {
    headers: {
      "cache-control": "no-cache",
      "content-length": String(stylesheet.byteLength),
      "content-type": "text/css; charset=UTF-8",
    },
  });
}
