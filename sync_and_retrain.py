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
    for doc in documents:
        fields = doc.get('fields', {})
        # Map Firestore types to Python values
        row = {
            'Text': fields.get('text', {}).get('stringValue', ''),
            'AI Score': float(fields.get('ai_score', {}).get('doubleValue', fields.get('ai_score', {}).get('integerValue', 0))),
            'Label': 'organic-human' if fields.get('slop_type', {}).get('stringValue') == 'type_organic_human' else 
                     'slop-factory' if fields.get('manual_report', {}).get('booleanValue') else 'ai-generated'
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
