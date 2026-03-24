import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.model_selection import StratifiedKFold, cross_validate
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.neural_network import MLPClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline, FeatureUnion
from sklearn.base import BaseEstimator, TransformerMixin

# --- 1. Feature Engineering: Extraction of Metadata/Keywords ---
class TextStatsExtractor(BaseEstimator, TransformerMixin):
    """Extracts numerical features from text data."""
    def fit(self, x, y=None):
        return self
    
    def transform(self, posts):
        slop_keywords = [
            "save this", "follow me", "dm you", "dm me", "breaking:", "just killed", 
            "money-making", "passive income", "7 prompts", "12 prompts", 
            "ultimate guide", "free", "retweet", "comment"
        ]
        
        features = []
        for text in posts:
            text_lower = str(text).lower()
            feat = [
                len(text_lower), # Length of tweet
                text_lower.count('!'), # Exclamation density
                text_lower.count('?'), # Question density
                sum(1 for kw in slop_keywords if kw in text_lower), # Specific 'slop' keywords
                1 if 'http' in text_lower else 0 # Contains URL
            ]
            features.append(feat)
        return np.array(features)

# --- 2. Data Preparation ---
def prepare_data(file_path):
    df = pd.read_csv(file_path)
    df['Text'] = df['Text'].fillna('')
    
    # Encode target labels
    le = LabelEncoder()
    y = le.fit_transform(df['Label'])
    
    # Feature Engineering Step 1: TF-IDF on Text
    tfidf = TfidfVectorizer(max_features=1000, stop_words='english')
    X_tfidf = tfidf.fit_transform(df['Text']).toarray()
    
    # Feature Engineering Step 2: Metadata Stats
    stats_extractor = TextStatsExtractor()
    X_stats = stats_extractor.transform(df['Text'])
    
    # Feature Engineering Step 3: Combine with numerical columns (AI Score)
    X_combined = np.hstack([X_tfidf, X_stats, df[['AI Score']].values])
    
    # Final Scale (Crucial for MLP and Logistic Regression)
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_combined)
    
    return X_scaled, y, le.classes_

# --- 3. Main Cross-Validation Routine ---
def run_benchmark(file_path):
    X, y, classes = prepare_data(file_path)
    print(f"Dataset loaded. Classes: {classes}\n")
    
    # Define models
    models = {
        'XGBoost': xgb.XGBClassifier(use_label_encoder=False, eval_metric='mlogloss', random_state=42),
        'MLP (Neural Net)': MLPClassifier(hidden_layer_sizes=(64, 32), max_iter=1000, random_state=42),
        'Logistic Regression': LogisticRegression(max_iter=1000, multi_class='multinomial', random_state=42)
    }
    
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    results = {}

    for name, model in models.items():
        print(f"Training {name}...")
        cv_results = cross_validate(model, X, y, cv=skf, scoring=['accuracy', 'f1_macro'])
        results[name] = {
            'Accuracy': f"{np.mean(cv_results['test_accuracy']):.2%}",
            'F1-Score': f"{np.mean(cv_results['test_f1_macro']):.4f}"
        }

    # Output Final Results
    report = pd.DataFrame(results).T
    print("\n--- Final Cross-Validation Results ---")
    print(report)

if __name__ == "__main__":
    run_benchmark('zeroslop_dataset_final_corrected.csv')
