package api

import (
	"com.enesuysal/go-chat/api/ent"
	"com.enesuysal/go-chat/api/ent/message"
	"com.enesuysal/go-chat/api/ent/user"
	"context"
	"database/sql"
	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"fmt"
	_ "github.com/jackc/pgx/v4/stdlib"
	"log"
	"time"
)

func OpenDb() *ent.Client {
	client, err := sql.Open("pgx", "postgresql://enes:123@pg/chat")
	if err != nil {
		log.Fatalf("failed opening connection to sqlite: %v", err)
	}

	drv := entsql.OpenDB(dialect.Postgres, client)
	db := ent.NewClient(ent.Driver(drv))

	// Run the auto migration tool.
	if err := db.Schema.Create(context.Background()); err != nil {
		log.Fatalf("failed creating schema resources: %v", err)
	}
	return db
}

func CreateUser(ctx context.Context, username string, name string, surname string, client *ent.Client) (*ent.User, error) {
	u, err := client.User.
		Create().
		SetUsername(username).
		SetName(name).
		SetSurname(surname).
		SetToken("token").
		SetIsOnline(0).
		Save(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed creating user: %w", err)
	}
	log.Println("user was created: ", u)
	return u, nil
}

func QueryUser(ctx context.Context, uname string, client *ent.Client) (*ent.User, error) {
	u, err := client.User.
		Query().
		Where(user.UsernameEQ(uname)).
		Only(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed querying user: %w", err)
	}
	log.Println("user returned: ", u)
	return u, nil
}

func QueryOnlineUsers(ctx context.Context, client *ent.Client) ([]*ent.User, error) {
	u, err := client.User.
		Query().
		Where(user.IsOnlineEQ(1)).
		All(ctx)
	fmt.Printf("LEN: %d\n", len(u))
	if err != nil {
		return nil, fmt.Errorf("failed querying user: %w", err)
	}

	return u, nil
}

func QueryUserbyToken(ctx context.Context, token string, client *ent.Client) (*ent.User, error) {
	u, err := client.User.
		Query().
		Where(user.TokenEQ(token)).
		Only(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed querying user: %w", err)
	}
	log.Println("user returned: ", u)
	return u, nil
}

func CreateMessage(ctx context.Context, client *ent.Client, senderUser string, receiverUser string, message string) (*ent.Message, error) {
	owner, _ := QueryUser(ctx, receiverUser, client)
	print(owner.Username)

	msg, err := client.Message.
		Create().
		SetSenderUsername(senderUser).
		SetReceiverUsername(receiverUser).
		SetMessage(message).
		SetSendTime(time.Now()).
		SetSeen(0).
		SetOwner(owner).
		Save(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed creating car: %w", err)
	}

	return msg, nil
}

func QueryMessagesUsers(ctx context.Context, user *ent.User) ([]string, error) {
	// user, _ := QueryUser(ctx, username, client)

	msgs, err := user.QueryMessage().Order(ent.Asc("send_time")).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed querying user messages: %w", err)
	}

	result := make([]string, 0)
	for _, msg := range msgs {
		result = append(result, msg.Message)
	}

	return result, nil
}

func QueryLastMessages(ctx context.Context, user *ent.User) ([]*ent.Message, error){
	msgs, err := user.QueryMessage().Where(message.SeenEQ(0)).Order(ent.Asc("send_time")).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed querying user messages: %w", err)
	}

	for _, msg := range msgs {
		_, err := msg.Update().SetSeen(1).Save(context.Background())
		if err != nil {
			return nil, fmt.Errorf("failed querying user messages: %w", err)
		}
	}

	return msgs, nil
}
