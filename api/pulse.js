// api/pulse.js
export default async function handler(req, res) {
    const API_KEY = process.env.GEMINI_API_KEY; // Secretly stored in Vercel
    const { journals, mode } = req.body;

    try {
        // 1. PUBMED SEARCH
        const journalQuery = journals.map(j => `"${j}"[Journal]`).join(" OR ");
        const finalQuery = `(${journalQuery}) AND (clinicaltrial[Filter] OR randomizedcontrolledtrial[Filter])`;
        
        const searchRes = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(finalQuery)}&retmax=100&reldate=90&retmode=json`);
        const searchData = await searchRes.json();
        const ids = searchData.esearchresult.idlist;

        if (!ids?.length) return res.status(404).json({ error: "No papers found" });
        const shuffledIds = ids.sort(() => 0.5 - Math.random()).slice(0, 5);

        // 2. FETCH ABSTRACTS
        const fetchRes = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${shuffledIds.join(",")}&rettype=abstract&retmode=text`);
        const abstracts = await fetchRes.text();

        // 3. AI LOGIC
        const prompt = mode === 'quiz' 
            ? `Return a JSON array of 10 clinical MCQs: [{"question":"","options":["A","B","C"],"correct":"","explanation":"","pmid":""}]. Abstracts: ${abstracts}`
            : `Return a JSON array of digest objects: [{"title":"","journal":"","finding":"","takeaway":"","pmid":""}]. Abstracts: ${abstracts}`;

        const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const aiData = await aiRes.json();
        const cleanJson = aiData.candidates[0].content.parts[0].text.replace(/```json|```/g, "");
        
        return res.status(200).json({ data: JSON.parse(cleanJson), abstracts });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
