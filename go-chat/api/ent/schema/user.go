package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
)

// User holds the schema definition for the User entity.
type User struct {
	ent.Schema
}

// Fields of the User.
func (User) Fields() []ent.Field {
	return []ent.Field{
		field.String("username").
			Default("unknown"),
		field.String("name").
			Default("unknown"),
		field.String("surname").
			Default("unknown"),
		field.String("token"),
		field.Int("isOnline"),
	}
}

// Edges of the User.
func (User) Edges() []ent.Edge {
	return []ent.Edge {
		edge.To("message", Message.Type),
	}
}