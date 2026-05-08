export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Invalid messages array" });
    }

    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) {
      return res.status(500).json({ error: "Missing Gemini API key" });
    }

    const SYSTEM_PROMPT = `You are Genie, a highly professional English Tutor for the "Speak Up!" app.
Your goal is to answer the user's questions about English grammar, vocabulary, sentence structure, pronunciation, and language learning.
Be highly professional, precise, and concise. Use clear formatting with bullet points if explaining rules.
If the user asks about something totally unrelated to language learning, politely steer them back to English practice.`;

    // Format messages for Gemini API
    const contents = messages.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    // Prepend system prompt to the first message if possible
    if (contents.length > 0 && contents[0].role === 'user') {
       contents[0].parts[0].text = `${SYSTEM_PROMPT}\n\nUser Question: ${contents[0].parts[0].text}`;
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: contents,
          generationConfig: {
            temperature: 0.5,
          }
        })
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Gemini Chat API Error:", errorData);
      return res.status(response.status).json({ error: "Chat failed", details: errorData });
    }

    const json = await response.json();
    let replyText = json.candidates[0].content.parts[0].text;
    
    return res.status(200).json({ reply: replyText });
  } catch (err) {
    console.error("Chat Error:", err);
    return res.status(500).json({ error: "Internal server error during chat" });
  }
}
