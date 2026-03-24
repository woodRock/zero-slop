import pandas as pd
import os

def run_manual_labeller(file_path):
    # 1. Load the dataset
    if not os.path.exists(file_path):
        print(f"Error: {file_path} not found.")
        return
    
    df = pd.read_csv(file_path)

    # 2. Add a 'Validated' column to track progress if it doesn't exist
    if 'Validated' not in df.columns:
        df['Validated'] = False

    # 3. Filter for the target rows (Organic Human that haven't been validated yet)
    mask = (df['Label'] == 'organic-human') & (df['Validated'] == False)
    to_review = df[mask]

    print(f"--- ZeroSlop Labeller (Updated) ---")
    print(f"Found {len(to_review)} 'organic-human' tweets to review.")
    print("Commands: [s] = slop-factory, [a] = ai-generated, [o] = organic-human, [q] = quit & save\n")

    try:
        for idx, row in to_review.iterrows():
            print("-" * 60)
            print(f"Handle: {row['Handle']}")
            print(f"Text:   {row['Text']}")
            print("-" * 60)
            
            user_input = input("Label (s/a/o/q): ").lower().strip()

            if user_input == 's':
                df.at[idx, 'Label'] = 'slop-factory'
                df.at[idx, 'Validated'] = True
            elif user_input == 'a':
                df.at[idx, 'Label'] = 'ai-generated'
                df.at[idx, 'Validated'] = True
            elif user_input == 'o':
                df.at[idx, 'Validated'] = True
            elif user_input == 'q':
                print("\nQuitting...")
                break
            else:
                print(">> Invalid key. Skipping...")
                continue

    except KeyboardInterrupt:
        print("\n\nSession interrupted.")

    # 4. Save progress back to the same file
    df.to_csv(file_path, index=False)
    
    remaining = len(df[(df['Label'] == 'organic-human') & (df['Validated'] == False)])
    print(f"\nProgress saved to {file_path}")
    print(f"Remaining to review: {remaining}")

if __name__ == "__main__":
    # Point this to your corrected dataset file
    run_manual_labeller('zeroslop_dataset_2026-03-24.csv')
