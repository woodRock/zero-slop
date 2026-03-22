const ZeroSlopClassifier = {
    weights: null,

    async load() {
        if (this.weights) return;
        try {
            // In a real extension, we'd bundle this or fetch from a local file
            // For now, I'll provide a way to inject it
            const response = await fetch(chrome.runtime.getURL('model_weights.json'));
            this.weights = await response.json();
        } catch (e) {
            console.error("ZeroSlop: Failed to load classifier weights", e);
        }
    },

    predict(text, aiScore = 0) {
        if (!this.weights) return null;

        const features = this.extractFeatures(text, aiScore);
        const tfidfFeatures = this.transformTfidf(text);
        
        // Combine features: [tfidf (1000), numerical (7)]
        const x = [...tfidfFeatures, ...features];
        
        // Multinomial Logistic Regression: z = x * coef^T + intercept
        // We have 3 classes: ai-generated (0), organic-human (1), slop-factory (2)
        const scores = this.weights.intercept.map((inter, classIdx) => {
            let z = inter;
            for (let i = 0; i < x.length; i++) {
                z += x[i] * this.weights.coef[classIdx][i];
            }
            return z;
        });

        // Softmax to get probabilities
        const maxScore = Math.max(...scores);
        const expScores = scores.map(s => Math.exp(s - maxScore));
        const sumExp = expScores.reduce((a, b) => a + b, 0);
        const probs = expScores.map(s => s / sumExp);

        const bestClassIdx = probs.indexOf(Math.max(...probs));
        return {
            label: this.weights.labels[bestClassIdx],
            probability: probs[bestClassIdx],
            probabilities: {
                'ai-generated': probs[0],
                'organic-human': probs[1],
                'slop-factory': probs[2]
            }
        };
    },

    extractFeatures(text, aiScore) {
        const text_len = text.length;
        const words = text.split(/\s+/).filter(w => w.length > 0);
        const word_count = words.length;
        const avg_word_len = text_len / (word_count + 1);
        const exclamation_count = (text.match(/!/g) || []).length;
        const question_count = (text.match(/\?/g) || []).length;
        const emoji_count = (text.match(/[^\x00-\x7F]/g) || []).length;

        const raw = [aiScore, text_len, word_count, avg_word_len, exclamation_count, question_count, emoji_count];
        
        // Standardize
        return raw.map((val, i) => (val - this.weights.scaler_mean[i]) / this.weights.scaler_scale[i]);
    },

    transformTfidf(text) {
        const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
        const termCounts = {};
        words.forEach(w => {
            if (this.weights.vocabulary[w] !== undefined) {
                termCounts[w] = (termCounts[w] || 0) + 1;
            }
        });

        const tfidf = new Array(Object.keys(this.weights.vocabulary).length).fill(0);
        for (const [word, count] of Object.entries(termCounts)) {
            const idx = this.weights.vocabulary[word];
            // TF-IDF: count * idf
            tfidf[idx] = count * this.weights.idf[idx];
        }

        // L2 Normalization (Logistic Regression expects normalized input)
        const norm = Math.sqrt(tfidf.reduce((sum, val) => sum + val * val, 0));
        if (norm > 0) {
            for (let i = 0; i < tfidf.length; i++) tfidf[i] /= norm;
        }

        return tfidf;
    }
};
