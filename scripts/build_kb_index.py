"""OWNER: P2. Build the passage-side retrieval index.

Run:  PYTHONPATH=src python scripts/build_kb_index.py
Done when artifacts/kb_embeddings.npy has shape (22863, 384).
"""
from sentineldesk import retrieve

if __name__ == "__main__":
    retrieve.build_index()
