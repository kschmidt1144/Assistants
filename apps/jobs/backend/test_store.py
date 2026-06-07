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
