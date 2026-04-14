export default async function handler(req, res) {
    const API_KEY = process.env.GEMINI_API_KEY;
    const { journals, mode, specificId } = req.body;

    try {
        let idsToFetch = [];
        let allIdsPool = [];

        // 1. DETERMINE WHICH IDs TO PROCESS
        if (specificId) {
            // This handles both a single ID (for swap) and multiple IDs (for the quiz)
            idsToFetch = specificId.split(","); 
        } else {
            // INITIAL FETCH: Get 100 IDs from the last 90 days
            const journalQuery = journals.map(j => `"${j}"[Journal]`).join(" OR ");
            const finalQuery = `(${journalQuery}) AND (clinicaltrial[Filter] OR randomizedcontrolledtrial[Filter])`;
            
            const searchRes = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(finalQuery)}&retmax=100&reldate=90&retmode=json`);
            const searchData = await searchRes.json();
            allIdsPool = searchData.esearchresult.idlist || [];

            if (allIdsPool.length === 0) {
                return res.status(404).json({ error: "No papers found in the last 90 days." });
            }
            
            // Randomly pick 5 from the 100
            idsToFetch = allIdsPool.sort(() => 0.5 - Math.random()).slice(0, 5);
        }

        // 2. FETCH THE ACTUAL ABSTRACT TEXT FROM PUBMED
        const fetchRes = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${idsToFetch.join(",")}&rettype=abstract&retmode=text`);
        const abstracts = await fetchRes.text();

        // 3. CONSTRUCT THE AI PROMPT
        let prompt = "";
        if (mode === 'quiz') {
            prompt = `You are a clinical educator. Based on these abstracts, generate 10 high-yield Multiple Choice Questions. 
            Return ONLY a JSON array of objects. 
            Format: [{"question": "...", "options": ["A) ", "B) ", "C) "], "correct": "Letter", "explanation": "...", "pmid": "matching_id"}]
            Abstracts: ${abstracts}`;
        } else {
            prompt = `You are a senior clinical analyst. Summarize these abstracts into a JSON array of objects. 
            Format: [{"title": "...", "journal": "...", "finding": "...", "takeaway": "...", "pmid": "matching_id"}]
            Abstracts: ${abstracts}`;
        }

        // 4. CALL GEMINI 3 FLASH
        const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { response_mime_type: "application/json" }
            })
        });

        const aiData = await aiRes.json();
        
        if (aiData.error) {
            return res.status(500).json({ error: aiData.error.message });
        }

        // Parse the AI's JSON response
        const aiText = aiData.candidates[0].content.parts[0].text;
        const parsedData = JSON.parse(aiText);
        
        // 5. SEND DATA BACK TO FRONTEND
        return res.status(200).json({ 
            data: parsedData, 
            abstracts: abstracts, 
            allIds: allIdsPool 
        });

    } catch (err) {
        console.error("Server Error:", err);
        return res.status(500).json({ error: "Internal Server Error: " + err.message });
    }
}
