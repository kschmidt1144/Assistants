from assistants_core.util.structured import object_schema

def test_object_schema():
    # default `required==all keys` + `additionalProperties:false`
    schema = object_schema(
        properties={"a": {"type": "string"}, "b": {"type": "integer"}}
    )
    assert schema["type"] == "object"
    assert schema["properties"]["a"]["type"] == "string"
    assert set(schema["required"]) == {"a", "b"}
    assert schema["additionalProperties"] is False

    # explicit required honored
    schema2 = object_schema(
        properties={"a": {"type": "string"}, "b": {"type": "integer"}},
        required=["a"]
    )
    assert schema2["required"] == ["a"]

    # additional=True flips it
    schema3 = object_schema(
        properties={"a": {"type": "string"}},
        additional=True
    )
    assert schema3["additionalProperties"] is True
