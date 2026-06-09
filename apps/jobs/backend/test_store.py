from store import JobsStore


async def test_dedup_and_status_history():
    st = await JobsStore(":memory:").connect()
    try:
        a = await st.upsert_application(title="ML Eng", company="Acme", url="https://acme.co/1", jd_text="Python AWS")
        # same URL → same id (dedup), fields refreshed, not duplicated
        a2 = await st.upsert_application(title="ML Eng Sr", company="Acme", url="https://acme.co/1", jd_text="...")
        assert a["id"] == a2["id"]
        assert len(await st.list_applications()) == 1

        await st.update_application(a["id"], status="Applied", notes="referred")
        got = await st.get_application(a["id"])
        assert got["status"] == "Applied"
        assert len(got["status_history"]) == 2  # New → Applied
        assert got["notes"] == "referred"
        assert (await st.stats())["Applied"] == 1
    finally:
        await st.close()


async def test_filter_and_profile():
    st = await JobsStore(":memory:").connect()
    try:
        await st.upsert_application(title="Data Eng", company="Beta", url="https://b/1", jd_text="x")
        await st.upsert_application(title="ML Eng", company="Acme", url="https://a/1", jd_text="y")
        assert len(await st.list_applications()) == 2
        assert len(await st.list_applications(query="acme")) == 1  # case-insensitive LIKE

        await st.set_profile("Jane Doe — ML engineer")
        assert await st.get_profile() == "Jane Doe — ML engineer"

        await st.delete_application(a_id := (await st.list_applications())[0]["id"])
        assert await st.get_application(a_id) is None
    finally:
        await st.close()

async def test_store_edges_k9_and_history():
    st = await JobsStore(":memory:").connect()
    try:
        # K9: two URL-less creates -> 2 rows
        a1 = await st.upsert_application(title="Job 1", company="X", jd_text="y")
        a2 = await st.upsert_application(title="Job 1", company="X", jd_text="y")
        assert a1["id"] != a2["id"]
        assert len(await st.list_applications()) == 2
        
        # update_application on missing id -> None
        assert await st.update_application("bogus") is None
        
        # notes-only update leaves status_history untouched
        hist_len = len(a1["status_history"])
        updated = await st.update_application(a1["id"], notes="hello")
        assert len(updated["status_history"]) == hist_len
        
        # status-history appends only on change
        updated = await st.update_application(a1["id"], status="Applied")
        hist_len2 = len(updated["status_history"])
        assert hist_len2 == hist_len + 1
        
        updated2 = await st.update_application(a1["id"], status="Applied") # same status
        assert len(updated2["status_history"]) == hist_len2
        
        # stats() grouping
        await st.update_application(a2["id"], status="Applied")
        stats = await st.stats()
        assert stats.get("Applied") == 2
    finally:
        await st.close()
