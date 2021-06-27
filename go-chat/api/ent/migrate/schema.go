// Code generated by entc, DO NOT EDIT.

package migrate

import (
	"entgo.io/ent/dialect/sql/schema"
	"entgo.io/ent/schema/field"
)

var (
	// MessagesColumns holds the columns for the "messages" table.
	MessagesColumns = []*schema.Column{
		{Name: "id", Type: field.TypeInt, Increment: true},
		{Name: "sender_username", Type: field.TypeString},
		{Name: "receiver_username", Type: field.TypeString},
		{Name: "message", Type: field.TypeString, Size: 2147483647},
		{Name: "send_time", Type: field.TypeTime},
		{Name: "seen", Type: field.TypeInt},
		{Name: "user_message", Type: field.TypeInt, Nullable: true},
	}
	// MessagesTable holds the schema information for the "messages" table.
	MessagesTable = &schema.Table{
		Name:       "messages",
		Columns:    MessagesColumns,
		PrimaryKey: []*schema.Column{MessagesColumns[0]},
		ForeignKeys: []*schema.ForeignKey{
			{
				Symbol:     "messages_users_message",
				Columns:    []*schema.Column{MessagesColumns[6]},
				RefColumns: []*schema.Column{UsersColumns[0]},
				OnDelete:   schema.SetNull,
			},
		},
	}
	// UsersColumns holds the columns for the "users" table.
	UsersColumns = []*schema.Column{
		{Name: "id", Type: field.TypeInt, Increment: true},
		{Name: "username", Type: field.TypeString, Default: "unknown"},
		{Name: "name", Type: field.TypeString, Default: "unknown"},
		{Name: "surname", Type: field.TypeString, Default: "unknown"},
		{Name: "token", Type: field.TypeString},
		{Name: "is_online", Type: field.TypeInt},
	}
	// UsersTable holds the schema information for the "users" table.
	UsersTable = &schema.Table{
		Name:        "users",
		Columns:     UsersColumns,
		PrimaryKey:  []*schema.Column{UsersColumns[0]},
		ForeignKeys: []*schema.ForeignKey{},
	}
	// Tables holds all the tables in the schema.
	Tables = []*schema.Table{
		MessagesTable,
		UsersTable,
	}
)

func init() {
	MessagesTable.ForeignKeys[0].RefTable = UsersTable
}