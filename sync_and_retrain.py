import requests
import json
import pandas as pd
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline

# Configuration from your background.js
FIREBASE_PROJECT_ID = "zero-slop"
FIREBASE_API_KEY = "AIzaSyDDx5ZbgWcgsKxsP78EubqyWRHL9yxdXec"

def fetch_registry_data():
    print("Fetching latest data from ZeroSlop Registry...")
    url = f"https://firestore.googleapis.com/v1/projects/{FIREBASE_PROJECT_ID}/databases/(default)/documents/slop_registry?key={FIREBASE_API_KEY}&pageSize=1000"
    
    response = requests.get(url)
    if not response.ok:
        print(f"Error fetching data: {response.text}")
        return None
    
    data = response.json()
    documents = data.get('documents', [])
    
    rows = []
    
    ORGANIC_GUARD_RULES = [
        # --- Hard Blocks (Points >= 5) ---
        r'\bfollow\s+(me|@\w+)\b', r'must follow', r'\bcomment\b.{0,30}\bto (get|receive|join|access)\b',
        r'\b(retweet|like\s+and\s+retweet)\b', r'\bbookmark\s+(this|it|now|thread|post)\b', r'\bsave\s+this\b',
        r'\b(dm\s+me|dm\s+for|send\s+me\s+(a\s+)?dm)\b',
        r'\$[\d,]+\+?\s*\/\s*(mo|month|day|week|hr|hour|year)', r'\$[\d,]+[k]?\s+per\s+(mo|month|day|week|hour)',
        r'\$[\d,]+.{0,40}(replac|instead of|consultant|lawyer|doctor|agency|degree|analyst|designer|copywriter)',
        r'\b(make|earn|generate|earning|making)\b.{0,20}\$[\d,]+',
        r'\b(money machine|cash machine|print money|income machine)\b', r'\bside\s+(hustle|income)\b', r'\bdata entry\b',
        r'\bhere are\s+[1-9]\d*\b', r'\b[1-9]\d*\s+prompts?\b',
        r'\b[1-9]\d*\s+(tools?|hacks?|tricks?|ways?|tips?|secrets?|mistakes?|steps?)\b',
        r'\b(use these|try these|steal these|copy these)\b.{0,20}\b(prompts?|tools?|tricks?)\b',
        r'\bact (as|like) (a |an )?(professional|expert|senior|world-class|harvard)',
        r'\bstep[\s-]by[\s-]step\b', r'\b[1-9]\d*\+?\s*free\s+(ai\s+)?courses?\b',
        r'\bBREAKING\b', r'\bGOODBYE\b', r'\bR\.?I\.?P\.?\b', r'\bSTOP (telling|using|doing|saying)\b',
        r'\bCANCELLED\b.{0,60}(chatgpt|netflix|spotify|prime|subscription)',
        r'\b(most people don.t know|nobody (talks|is talking) about|very few (know|people)|hardly anyone|95% of people|99% of people)\b',
        r'\bfor free\b', r'\bfaceless\b', r'passive income',
        r'\bno (experience|skills?|coding|degree|team|budget|camera|luck)\b',
        r'\bzero to.{0,30}(income|money|\$)\b', r'\b(forget|ditch|quit|goodbye|replace)\s+chatgpt\b',
        r'\b(giveaway|giving away)\b', r'\b(prize|reward).{0,30}(follow|retweet|like|comment|enter)',
        r'\bfree for \d+\s*hours?\b', r'\b(limited (spots?|seats?)|only \d+ spots?)\b',
        r'\b(paid courses?).{0,30}free\b', r'\ball paid.{0,20}free\b',
        r'\b(blueprint|masterclass|cheatsheet|playbook).{0,40}(free|get|dm|comment|follow)\b',
        r'\b(course|ebook|pdf).{0,40}\$[\d,]+\b',
        r'\bgrok.{0,20}imagine\b', r'\b(apob|pollo ai|seedance|heygen|synthesia)\b',
        r'\bai\s+ugc\b', r'\bupload.{0,20}(photo|video|image).{0,40}(generate|create|make|turn into)\b',
        r'\b(stop|still)\s+paying\s+for\b.{0,30}(storage|icloud|gmail|subscription)',
        r'\bI\s+(found|discovered)\s+a\s+(way|secret|tool)\b',
        r'\b(I\s+)?hope\s+this\s+helps\s+you\s*↓',
        r'\bstop\s+(declining|rejecting)\s+spam\s+calls\b',
        r'\bif\s+your\s+iphone\s+gets\s+stolen\b',
        r'\b(most|9[59]% of)\s+(developers|students|people)\s+are\s+using\b.{0,30}\bwrong\b',
        r'\bsomeone\s+(built|leaked|compiled|just)\s+a\s+(tool|skill|system|repo|skill)\b',
        r'\b(your|a)\s+\$[\d,]+\s+camera\b.{0,50}\blosing\b',
        r'\b(vibe\s+coding|claude\s+code|openclaw)\b',
        r'\b(don.t|do\s+not)\s+change\s+the\s+iphone\b',
        r'\bbest\s+for\s+(logic|writing|research|video)\b',

        # --- Soft Signals (Points < 5, still reclassify as slop-factory for safety) ---
        r'[\u{1D400}-\u{1D7FF}]', r'(changed my life|show more|read on|curiosity)', r'\+.{0,20}\+.{0,20}='
    ]

    for doc in documents:
        fields = doc.get('fields', {})
        ai_score = float(fields.get('ai_score', {}).get('doubleValue', fields.get('ai_score', {}).get('integerValue', 0)))
        slop_type = fields.get('slop_type', {}).get('stringValue')
        is_manual = fields.get('manual_report', {}).get('booleanValue', False)
        text = fields.get('text', {}).get('stringValue', '')
        
        is_slop_heuristic = any(re.search(rule, text, re.IGNORECASE if "BREAKING" not in rule else 0) for rule in ORGANIC_GUARD_RULES)

        label = 'organic-human'
        if ai_score > 15:
            label = 'ai-generated'
        elif (slop_type and slop_type != 'type_organic_human') or \
           (is_manual and slop_type != 'type_organic_human') or \
           (is_slop_heuristic and slop_type != 'type_organic_human'):
            label = 'slop-factory'
            
        row = {
            'Text': text,
            'AI Score': ai_score,
            'Label': label
        }
        if row['Text']:
            rows.append(row)
            
    print(f"Downloaded {len(rows)} samples from the registry.")
    return pd.DataFrame(rows)

def train_and_export(df):
    print("Retraining model...")
    # Basic Feature Engineering
    df['text_len'] = df['Text'].apply(len)
    df['word_count'] = df['Text'].apply(lambda x: len(x.split()))
    df['avg_word_len'] = df['text_len'] / (df['word_count'] + 1)
    df['exclamation_count'] = df['Text'].apply(lambda x: x.count('!'))
    df['question_count'] = df['Text'].apply(lambda x: x.count('?'))
    df['emoji_count'] = df['Text'].apply(lambda x: sum(1 for char in x if ord(char) > 127))

    X = df[['Text', 'AI Score', 'text_len', 'word_count', 'avg_word_len', 'exclamation_count', 'question_count', 'emoji_count']]
    y = df['Label']

    le = LabelEncoder()
    y_encoded = le.fit_transform(y)

    preprocessor = ColumnTransformer(
        transformers=[
            ('text', TfidfVectorizer(max_features=1000, stop_words='english'), 'Text'),
            ('num', StandardScaler(), ['AI Score', 'text_len', 'word_count', 'avg_word_len', 'exclamation_count', 'question_count', 'emoji_count'])
        ]
    )

    clf = LogisticRegression(max_iter=1000)
    pipe = Pipeline([('pre', preprocessor), ('clf', clf)])
    pipe.fit(X, y_encoded)

    # Export Logic
    tfidf = pipe.named_steps['pre'].named_transformers_['text']
    scaler = pipe.named_steps['pre'].named_transformers_['num']
    lr_model = pipe.named_steps['clf']

    model_data = {
        'labels': le.classes_.tolist(),
        'vocabulary': {k: int(v) for k, v in tfidf.vocabulary_.items()},
        'idf': tfidf.idf_.tolist(),
        'scaler_mean': [float(x) for x in scaler.mean_],
        'scaler_scale': [float(x) for x in scaler.scale_],
        'coef': lr_model.coef_.tolist(),
        'intercept': lr_model.intercept_.tolist()
    }

    with open('model_weights.json', 'w') as f:
        json.dump(model_data, f)
    
    print("Success! Updated model_weights.json with latest community data.")

if __name__ == "__main__":
    registry_df = fetch_registry_data()
    if registry_df is not None and len(registry_df) > 10:
        # Mix in the original dataset to ensure stability if registry is still small
        try:
            original_df = pd.read_csv('zeroslop_dataset_2026-03-22.csv')
            combined_df = pd.concat([registry_df, original_df]).drop_duplicates(subset=['Text'])
            train_and_export(combined_df)
        except:
            train_and_export(registry_df)
    else:
        print("Not enough new data in registry to warrant a retrain yet.")
