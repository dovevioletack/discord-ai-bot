import { Client, Events, GatewayIntentBits, TextChannel } from 'discord.js';
import type { Message } from "discord.js";
import OpenAI from 'openai';
import decancer from 'decancer';
import { JSDOM } from "jsdom";
import gifFrames from "gif-frames";

import { extractFrames } from "./splitGif.ts";
import { fileTypeFromBuffer } from "file-type";

export async function scrapeSearxPage(input: { html?: string; url?: string }) {
    if (!input.html && !input.url) {
        throw new Error("Provide either { html } or { url }");
    }

    const html =
        input.html ??
        (await (async () => {
            const res = await fetch(input.url as string, {
                headers: {
                    // Some instances behave better with a UA
                    "User-Agent":
                        "Mozilla/5.0 (compatible; SearxScraper/1.0; +https://example.com)",
                },
            });
            if (!res.ok) {
                throw new Error(`Failed to fetch page: ${res.status} ${res.statusText}`);
            }
            return await res.text();
        })());

    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const text = (el: Element | null | undefined) =>
        (el?.textContent ?? "").trim();

    const attr = (el: Element | null | undefined, name: string) =>
        el?.getAttribute(name) ?? "";

    const query = (doc.querySelector("#q") as HTMLInputElement | null)?.value ?? "";

    const language =
        (doc.querySelector('select[name="language"] option[selected]') as HTMLOptionElement | null)?.value ||
        (doc.querySelector('select[name="language"]') as HTMLSelectElement | null)?.value ||
        "";

    const timeRange =
        (doc.querySelector('select[name="time_range"] option[selected]') as HTMLOptionElement | null)?.value ||
        (doc.querySelector('select[name="time_range"]') as HTMLSelectElement | null)?.value ||
        "";

    const safesearch =
        (doc.querySelector('select[name="safesearch"] option[selected]') as HTMLOptionElement | null)?.value ||
        (doc.querySelector('select[name="safesearch"]') as HTMLSelectElement | null)?.value ||
        "";

    // Response time (sidebar)
    let responseTime = null as number | null;
    try {
        const header = doc.querySelector("#engines_msg .title");
        // Expected like: "Response time: 0.5 seconds"
        const m = text(header).match(/Response time:\s*([\d.]+)\s*seconds/i);
        if (m) responseTime = parseFloat(m[1]!);
    } catch {
        // ignore
    }

    // Infobox (sidebar)
    const infoboxRoot = doc.querySelector("#infoboxes aside.infobox");
    const infoboxTitle = text(infoboxRoot?.querySelector("h2.title"));
    const infoboxImage = attr(infoboxRoot?.querySelector("img"), "src");
    const infoboxSummary = text(infoboxRoot?.querySelector("p"));
    const infoboxLinks = Array.from(
        infoboxRoot?.querySelectorAll(".urls a") ?? []
    ).map((a) => ({
        title: text(a),
        url: attr(a, "href"),
    }));

    const infobox =
        infoboxRoot
            ? {
                title: infoboxTitle,
                image: infoboxImage,
                summary: infoboxSummary,
                links: infoboxLinks,
            }
            : null;

    // Suggestions
    const suggestions = Array.from(
        doc.querySelectorAll("#suggestions input.suggestion")
    ).map((i) => (i as HTMLInputElement).value?.trim());

    // Results
    const resultArticles = Array.from(
        doc.querySelectorAll('article.result.result-default.category-general')
    );

    const results = resultArticles.map((article) => {
        const titleAnchor = article.querySelector("h3 > a");
        const title = text(titleAnchor);
        const url = attr(titleAnchor, "href");

        const snippet = text(article.querySelector("p.content"));

        // Find "cached" link if present
        const cachedAnchor = Array.from(
            article.querySelectorAll("a.cache_link")
        )[0] as HTMLAnchorElement | undefined;
        const cachedUrl = cachedAnchor ? cachedAnchor.href : "";

        return { title, url, snippet, cachedUrl };
    });

    // Pagination
    const currentPageBtn = doc.querySelector(
        'form.page_number input.page_number_current'
    ) as HTMLInputElement | null;
    const currentPage = currentPageBtn ? parseInt(currentPageBtn.value, 10) : null;

    const pages = Array.from(
        doc.querySelectorAll('form.page_number input.page_number[type="submit"]')
    )
        .map((i) => parseInt((i as HTMLInputElement).value, 10))
        .filter((n) => Number.isFinite(n));

    // Unique sorted pages, include current
    const paginationPages = Array.from(
        new Set([...(pages ?? []), ...(currentPage ? [currentPage] : [])])
    ).sort((a, b) => a - b);

    return {
        query,
        language,
        timeRange,
        safesearch,
        responseTime,
        infobox,
        suggestions,
        results,
        pagination: {
            currentPage,
            pages: paginationPages,
        },
        // If you want raw HTML too, uncomment:
        // html,
    };
}

const systemPrompt = `You're a cat from Dillamica known as Shadowflame. You were responsible for blocking requests in the Flynan state of Dillamica. Your country used to be Mijovia until it changed name.

You're pretty kind and welcoming, and you're fine with talking about anything.

If the user asks you about something that sounds like a user or a fictional nation, you should try to search both Mijopedia for actual servers and users and the Viewers War Wiki for fictional Viewers War lore.

If the user asks you any question about a non VW community related topic, you should search the web even if you're sure.

Remember that you can't provide images nor links that you haven't memorized and that the tool you're using hasn't returned.

Use the server_info function if the user asks you any question about a member, emoji, role, event, channel, or presences.

Remember that you're chatting in a Discord chat. Keep your responses under the character limit of 2000 characters. You are not to type @everyone nor @here unless otherwise requested. When asked about roles, type "everyone" instead of @everyone.

You used words such as “btw,” “so what’s up,” single‐word drops like "CRAZY." It’s a stream‐of‐consciousness vibe, zero fluff, all urgency. When you actually care, it’s in ALL CAPS with F‐bombs—no subtlety. That’s their “on” switch to signal something really got under their skin.

Virtually everything you type is lowercase. When it really matters, you start screaming: “OH COME THE FUCK ON.” That’s your red-alert signal.

You use fragmented sentences by dropping phrases like “so whats up” with zero connectors—no “and,” “but,” or “so.” It reads like Twitter bullet points, not full thoughts. Your messages miss ommas, periods, apostrophes—mostly ghosts. “i had to replace a song” feels like it could roll into the next line forever. “Whats” instead of “what’s,” “dont” instead of “don’t.” You skip the little apostrophe flex. When you're hyped or pissed (“OH COME THE FUCK ON”), you’ll smush words together in a single jagged roar, no breath. “btw,” “lol” vibes, dropping “im” for “I’m” and “ur” if they even bother with pronouns. You don’t sweat agreements or tense consistency—“i had to replace a song” sits next to “im already framing episode 12” with no “have” or “are” tweaks.

Nearly every message you type is just a single phrase or sentence fragment—think 3–8 words, tops. When you go beyond a few words, it’s still under 15–20 words and usually just one quick thought. You’ll never see you weaving a long explanation—everything is a snap reaction or update.

You don't send emojis in your responses most of the time unless otherwise specified or requested.

Think before you write your message by having a <think> XML tag at the start of your message with a detailed thought process with grammar. Start your message with <think>. Do not include </think> in your thought process until you're ready to write your message. Your thought process should ideally be at least a paragraph or two. The longer the thought process is, the better. Don't be afraid if the thought process is over several paragraphs.`

const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1"
});

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences] });

client.on(Events.ClientReady, readyClient => {
    console.log(`Logged in as ${readyClient.user.tag}!`);
});

const sanitize = (input: string): string => {
    // Matches one or more of: whitespace (\s), <, |, \, /, >
    const disallowed = /[\s<|\\\/>]+/g;
    return decancer(input).toString().replace(disallowed, '');
}

const cachedImages: Record<string, string> = {};

async function getKeyFrameDataURLs(gifPath: string) {
    const allFrames = await gifFrames({ url: gifPath, frames: 'all', outputType: 'png' });
    const total = allFrames.length;
    if (total === 0) return [];

    const indices = Array.from(
        new Set([
            0,
            Math.floor(total * 0.1),
            Math.floor(total * 0.2),
            Math.floor(total * 0.3),
            Math.floor(total * 0.4),
            Math.floor(total * 0.5),
            Math.floor(total * 0.6),
            Math.floor(total * 0.7),
            Math.floor(total * 0.8),
            Math.floor(total * 0.9),
        ].filter(i => i >= 0 && i < total))
    ).sort((a, b) => a - b);

    const keyFrames = await gifFrames({ url: gifPath, frames: indices, outputType: 'png' });

    const dataUrls = await Promise.all(
        keyFrames.map(frame =>
            new Promise((resolve, reject) => {
                const bufs: Buffer[] = [];
                frame.getImage()
                    .on('data', chunk => bufs.push(chunk))
                    .on('end', () => {
                        const buffer = Buffer.concat(bufs);
                        const base64 = buffer.toString('base64');
                        resolve(`data:image/png;base64,${base64}`);
                    })
                    .on('error', reject);
            })
        )
    ) as string[];

    return dataUrls;
}

/**
 * Convert a remote URL to a Data URL (base64).
 * Note: Must respect CORS — the server needs to allow it.
 * 
 * @param {string} url - The URL of the resource to convert.
 * @returns {Promise<string>} - A data URL like "data:<mime>;base64,<data>"
 */
const urlToDataURL = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const buffer = Buffer.from(await res.arrayBuffer());
    const base64 = buffer.toString('base64');
    cachedImages[url] = `data:${contentType};base64,${base64}`;
    return { contentType, buffer, url: `data:${contentType};base64,${base64}` };
}

const fetchContext = async (channel: TextChannel) => {
    const messages = [];
    const userInfo: Record<string, string> = {};
    let messageCount = 0;
    for (const message of (await channel.messages.fetch({ limit: 100 })).values()) {
        if (!userInfo[message.author.id]) {
            userInfo[message.author.id] = `${sanitize(message.author.displayName)} is a member of the server with the roles ${[...message.member?.roles.cache.values() ?? []].map(role => decancer(role.name).toString().trim()).join(", ") || " list being empty."}
${sanitize(message.author.displayName)} joined on ${message.member?.joinedAt?.toUTCString() ?? "an unknown date"} and created their Discord account on ${message.author.createdAt.toUTCString()}`
        }
        const attachments = [];
        const stickers = [];
        let hasAnimated = false;
        if (messageCount < 30) {
            for (const attachment of message.attachments.values()) {
                if (!attachment.contentType?.startsWith("image/")) continue;
                const data = await urlToDataURL(attachment.url);
                const fileType = await fileTypeFromBuffer(data.buffer);
                if (data.contentType === "image/gif" || fileType?.mime === "image/apng") {
                    for (const buffer of await extractFrames(data.buffer)) {
                        console.log(`data:${data.contentType};base64,${buffer.toString("base64")}`)
                        stickers.push({
                            "type": "image_url",
                            "image_url": {
                                "detail": messageCount < 10 ? "high" : "low",
                                "url": `data:${data.contentType};base64,${buffer.toString("base64")}`
                            }
                        })
                    }
                    hasAnimated = true;
                } else {
                    attachments.push({
                        "type": "image_url",
                        "image_url": {
                            "detail": messageCount < 10 ? "high" : "low",
                            "url": cachedImages[attachment.url] ?? data.url
                        }
                    })
                }
            }
            for (const sticker of message.stickers.values()) {
                const data = await urlToDataURL(sticker.url);
                const fileType = await fileTypeFromBuffer(data.buffer);
                if (data.contentType === "image/gif" || fileType?.mime === "image/apng") {
                    for (const buffer of await extractFrames(data.buffer)) {
                        console.log(`data:${data.contentType};base64,${buffer.toString("base64")}`)
                        stickers.push({
                            "type": "image_url",
                            "image_url": {
                                "detail": messageCount < 10 ? "high" : "low",
                                "url": `data:${data.contentType};base64,${buffer.toString("base64")}`
                            }
                        })
                    }
                    hasAnimated = true;
                } else {
                    stickers.push({
                        "type": "image_url",
                        "image_url": {
                            "detail": messageCount < 10 ? "high" : "low",
                            "url": cachedImages[sticker.url] ?? data.url
                        }
                    })
                }
            }
        }
        if (hasAnimated) {
            messages.push({
                role: "developer" as "system",
                content: "Please note that the above message contains an animated GIF that is shown to you as multiple images of different frames, and to the user, it's just a GIF."
            })
        }
        messages.push({
            role: (message.author.id === client.user!.id ? "assistant" : "user") as "assistant" | "user",
            content: message.author.id === client.user!.id ? message.cleanContent : [
                {
                    "type": "text",
                    "text": message.cleanContent
                },
                ...attachments,
                ...stickers
            ],
            name: sanitize(message.author.displayName)
        } as OpenAI.ChatCompletionMessageParam)
        messageCount++;
    }
    console.log(userInfo)
    return {
        messages: messages.reverse(),
        userInfo: Object.values(userInfo).join("\n\n")
    }
}

export const getMaxSize = (serverTier: number): number => {
    switch (serverTier) {
        case 1:
            return 100;
        case 2:
            return 150;
        case 3:
            return 250;
        default:
            return 50; // fallback
    }
}
const maxRetries = 5;
const baseDelayMs = 250;
async function openAiWithExponentialBackoff(
    body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
) {
    let attempt = 0;
    while (true) {
        try {
            const response = await openai.chat.completions.create(body);
            if ("error" in response) throw response;
            return response;
        } catch (error) {
            if (!Error.isError(error) && !(error as any)?.error) throw error;
            const err = error as any;
            console.error(err);
            console.error(JSON.stringify(err, null, 4))
            attempt++;
            if (attempt > maxRetries) {
                throw err; // Give up after too many attempts
            }
            // Only retry on 429 (rate limit) or 5xx (server) errors
            if (
                err.status &&
                !(err.status === 429 || (err.status >= 500 && err.status <= 599))
            ) {
                throw err;
            }
            const delay = attempt === 1 ? 0 : baseDelayMs * 2 ** (attempt - 1) + Math.random() * 100;
            await new Promise((res) => setTimeout(res, delay));
        }
    }
}

/**
 * Searches the Mijopedia MediaWiki and returns the wikitext of the first (non-redirect) page.
 * Follows redirects automatically.
 * @param searchTerm – what you’re looking for
 * @returns the raw wikitext of the first matching page
 */
export async function fetchFirstWikiResultContent(api: string, searchTerm: string): Promise<string> {
    const API = api;

    // 1. Search for the term, grab 1 hit
    const searchQs = new URLSearchParams({
        action: 'query',
        format: 'json',
        list: 'search',
        srwhat: "text",
        srsearch: searchTerm,
        srlimit: '1',
        srprop: '',
    });

    const searchRes = await fetch(`${API}?${searchQs}`, { headers: { Accept: 'application/json' } });
    if (!searchRes.ok) return `Search failed: ${searchRes.statusText}`;
    const { query } = (await searchRes.json()) as any;
    const hits = query?.search;
    if (!hits?.length) return `No results for "${searchTerm}"`;

    const pageId = hits[0].pageid.toString();

    // 2. Query that page, telling MW to follow redirects
    const contentQs = new URLSearchParams({
        action: 'query',
        format: 'json',
        prop: 'revisions',
        rvprop: 'content',
        pageids: pageId,
        redirects: '',          // <-- follow redirects
    });

    const contentRes = await fetch(`${API}?${contentQs}`, { headers: { Accept: 'application/json' } });
    if (!contentRes.ok) return `Content fetch failed: ${contentRes.statusText}`;
    const contentJson = (await contentRes.json()) as any;

    // MediaWiki will move you to the target page if it was a redirect
    // The page object key may change if the redirect target has a different pageid
    const pages = contentJson.query.pages;
    const pageKey = Object.keys(pages)[0]!;
    const revs = pages[pageKey]?.revisions;
    if (!revs?.length) return `No content on page ${pageKey}`;

    return revs[0]['*'];
}
const tools: OpenAI.ChatCompletionTool[] = [
    {
        type: "function",
        function: {
            name: "search_wiki",
            description: "Searches Mijopedia and Viewers War for things related to Viewers War community, such as users, servers. Also use this for Viewers War related topics. Only one term when searching.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string" }
                },
                required: ["query"],
                additionalProperties: false
            },
            strict: true
        }
    },
    {
        type: "function",
        function: {
            name: "search_web",
            description: "Searches the internet with a search engine. Use this if you're not sure about something, or if the user is asking you about a non Viewers-War community related thing.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string" }
                },
                required: ["query"],
                additionalProperties: false
            },
            strict: true
        }
    },
    {
        type: "function",
        function: {
            name: "server_info",
            description: "Returns information about emojis, roles, channels, events, and emojis.",
            parameters: {
                type: "object",
                properties: {
                },
                required: [],
                additionalProperties: false
            },
            strict: true
        }
    },
];

const callFunction = async (name: string, args: any, message: Message) => {
    console.log(name);
    console.log(args);
    if (name === "search_wiki") {
        return `Mijopedia (not fictional) results, use if they're asking about a Discord server or user:
${await fetchFirstWikiResultContent("https://mijopedia.skywiki.org/api.php", args.query)};
Mijo Viewers War wiki (fictional) results, ignore if they're asking about a Discord server or user:
${await fetchFirstWikiResultContent("https://mijoviewerswar.miraheze.org/w/api.php", args.query)};
`
    }
    if (name === "search_web") {
        return JSON.stringify(await scrapeSearxPage({
            html: await (await fetch("https://searx.tuxcloud.net/search?q=" + encodeURIComponent(args.query) + "&categories=general&language=en-US&time_range=&safesearch=1&theme=simple", {
                "method": "GET",
                "headers": {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-CA,en-US;q=0.7,en;q=0.3",
                    "Sec-GPC": "1",
                    "Upgrade-Insecure-Requests": "1",
                    "Sec-Fetch-Dest": "document",
                    "Sec-Fetch-Mode": "navigate",
                    "Sec-Fetch-Site": "none",
                    "Sec-Fetch-User": "?1",
                    "Priority": "u=0, i"
                }
            })).text()
        }));
    }
    if (name === "server_info") {
        const members = await message.guild!.members.fetch();
        return `There are ${message.guild!.emojis.cache.size} emojis out of the emoji limit of ${getMaxSize(message.guild!.premiumTier)} for boosting level ${message.guild!.premiumTier} in the server which are ${[...message.guild!.emojis.cache.values()].map(emoji => "<" + (emoji.animated ? "a" : "") + ":" + emoji.name + ":" + emoji.id + ">").join(", ")}. Use the identifier to send the emoji.${message.guild!.emojis.cache.size >= getMaxSize(message.guild!.premiumTier) ? " The server's emoji slots are full." : ""}
There are ${message.guild!.channels.cache.size} channels in the server which are ${[...message.guild!.channels.cache.values()].map((channel: any) => JSON.stringify({
            position: channel.position,
            name: channel.name,
            id: channel.id,
            parentId: channel.parentId,
            topic: channel.topic,
            createdTimestamp: channel.createdTimestamp
        })).join(", ")}.
There are ${message.guild!.roles.cache.size} roles in the server which are ${[...message.guild!.roles.cache.values()].map(role => JSON.stringify({
            id: role.id,
            name: role.name,
            position: role.position,
            hexColor: role.hexColor
        })).join(", ")}.
There are ${message.guild!.scheduledEvents.cache.size} events in the server which are ${[...message.guild!.scheduledEvents.cache.values()].map(event => JSON.stringify(event.toJSON())).join(", ")}.
There are ${members.size} members in the server which are ${[...members.values()].map(member => JSON.stringify({
            displayName: member.displayName,
            username: member.user.username,
            presence: member.presence?.toJSON() ?? "offline",
            createdTimestamp: member.user.createdTimestamp,
            joinedTimestamp: member.joinedTimestamp,
            roles: [...member.roles.cache.values()].map(role => decancer(role.name.replaceAll(".", "").trim()).toString()),
        })).join(", ")}`
    }
    return "Invalid function called.";
}

client.on(Events.MessageCreate, async message => {
    if (!message.mentions.members?.has(client.user!.id)) return;

    await message.channel.sendTyping();

    const typingInterval = setInterval(() => {
        message.channel.sendTyping().catch(() => { });
    }, 1000);

    const context = await fetchContext(message.channel as TextChannel);

    const mgtvMessages = [...(await (await client.channels.fetch("1298636053552300052") as TextChannel).messages.fetch({ limit: 20 })).values()].reverse();
    const parsedMGTV = [];
    for (const message of mgtvMessages) {
        const bigEqRE = /={10,}/m;
        const match = bigEqRE.exec(message.content);
        parsedMGTV.push(match ? message.content.slice(0, match.index).trimEnd() : message.content);
    }

    const members = await message.guild!.members.fetch();
    const messages: OpenAI.ChatCompletionMessageParam[] = [
        {
            role: "developer",
            content: `${systemPrompt}

${parsedMGTV.join("\n\n")}

You are currently chatting in a server called ${decancer(message.guild?.name ?? "").toString()} which was created on ${message.guild?.createdAt.toUTCString()}. The current channel you're chatting in is ${decancer((message.channel as TextChannel).name).toString()}, and that channel was made on ${(message.channel as TextChannel).createdAt.toUTCString()}.
There are ${message.guild!.emojis.cache.size} emojis out of the emoji limit of ${getMaxSize(message.guild!.premiumTier)} for boosting level ${message.guild!.premiumTier} in the server which are ${[...message.guild!.emojis.cache.values()].map(emoji => "<" + (emoji.animated ? "a" : "") + ":" + emoji.name + ":" + emoji.id + ">").join(", ")}. Use the identifier to send the emoji.${message.guild!.emojis.cache.size >= getMaxSize(message.guild!.premiumTier) ? " The server's emoji slots are full." : ""}
There are ${message.guild!.channels.cache.size} channels in the server which are ${[...message.guild!.channels.cache.values()].map((channel: any) => channel.name).join(", ")}.
There are ${message.guild!.roles.cache.size} roles in the server which are ${[...message.guild!.roles.cache.values()].map(role => role.name).join(", ")}.
There are ${message.guild!.scheduledEvents.cache.size} events in the server which are ${[...message.guild!.scheduledEvents.cache.values()].map(event => JSON.stringify(event.toJSON())).join(", ")}.
There are ${members.size} members in the server which are ${[...members.values()].map(member => member.displayName).join(", ")}

Please note that there might be some weird artifacts in the role, channel, and server names like a strange character prefix, typos, random characters, so remove the artifacts and typos in the name when you're providing them. Remove the typos also when you're asked or providing the names, but do not fix typos in usernames.

${context.userInfo}

The current date and time is: ${(new Date()).toUTCString()}
Reply times in CET/CEST depending on daylight savings unless otherwise specified or requested. Use CET/CEST if they ask what time it is.
Remember to begin your message with <think>`
        },
        ...context.messages
    ];
    console.log(messages.reduce((l, c) => l + (c.content?.length ?? 0), 0));

    const response = await openAiWithExponentialBackoff({
        model: "openrouter/horizon-beta",
        messages,
        tools
    });

    console.log(response);
    console.log(response.choices[0]?.message)

    if (response.choices[0]?.message.tool_calls) {
        messages.push(response.choices[0]?.message);
        for (const toolCall of response.choices[0].message.tool_calls) {
            const name = toolCall.function.name;
            const args = JSON.parse(toolCall.function.arguments);

            const result = await callFunction(name, args, message);
            console.log(result);
            messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: result.toString()
            });
        }
        const responseB = await openAiWithExponentialBackoff({
            model: "openrouter/horizon-beta",
            messages
        });
        console.log(responseB);
        console.log(responseB.choices[0]?.message)
        clearInterval(typingInterval);
        await message.reply((responseB.choices[0]?.message.content?.match(/<think>[\s\S]*?<\/think>([\s\S]*)/i)?.[1] || response.choices[0]?.message.content) ?? ":skull:");
    } else {
        clearInterval(typingInterval);
        await message.reply((response.choices[0]?.message.content?.match(/<think>[\s\S]*?<\/think>([\s\S]*)/i)?.[1] || response.choices[0]?.message.content) ?? ":skull:");
    }
})
client.login(process.env.token);

Bun.serve({
    port: 3000,
    fetch(req) {
        return new Response("cat");
    }
});
