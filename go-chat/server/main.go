package main

import (
	"com.enesuysal/go-chat/api"
	"context"
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"github.com/rsms/gotalk"
	"log"
	"net/http"
	"sync"
)

type User struct {
	Name string `json:"name"`
	Surname string `json:"surname"`
	Username string `json:"username"`
}

type Token struct {
	Tkn string `json:"token"`
}

type Msg struct {
	Text string `json:"text"`
	Tkn string `json:"token"`
	Receiver string `json:"rcv"`
	Sender string `json:"sender"`
}

type MsgSender struct {
	Text string `json:"text"`
	Sender string `json:"sender"`
}

type OnLines struct {
	Users []User `json:"users"`
}

var (
	socks   map[*gotalk.WebSocket]int
	socksmu sync.RWMutex
	db = api.OpenDb()
)

func onConnect(s *gotalk.WebSocket) {
	socksmu.Lock()
	defer socksmu.Unlock()
	socks[s] = 1

	s.CloseHandler = func(s *gotalk.WebSocket, _ int) {
		fmt.Printf("Peer %s diconnected\n", s)

		if s.UserData != nil {
			u, _ := api.QueryUserbyToken(context.Background(), s.UserData.(string), db)
			u.Update().SetIsOnline(0).Save(context.Background())
			broadcast("hasLeft", u.Username, s.UserData.(string))
		}

		socksmu.Lock()
		defer socksmu.Unlock()
		delete(socks, s)
	}

	s.UserData = nil

	fmt.Printf("Peer %s connected on %s\n", s, s.Conn().LocalAddr())
}

func broadcast(name string, in interface{}, token string) {
	socksmu.RLock()
	defer socksmu.RUnlock()
	for s := range socks {
		if s.UserData != token {
			s.Notify(name, in)
		}
	}
}

func server() {
	socks = make(map[*gotalk.WebSocket]int)
	defer db.Close()

	gotalk.Handle("sendMsg", func(in Msg) error{
		u, _ := api.QueryUserbyToken(context.Background(), in.Tkn, db)
		if u != nil {
			message, _ := api.CreateMessage(context.Background(), db, u.Username, in.Receiver, in.Text)
			in.Sender = u.Username
			socksmu.RLock()
			defer socksmu.RUnlock()
			for s := range socks {
				u2, _ := api.QueryUserbyToken(context.Background(), s.UserData.(string), db)
				if  u2.Username == in.Receiver {
					s.Notify("newMsg", in)
					log.Printf("Message sended.")
				}
			}
			message.Update().SetSeen(1).Save(context.Background())
		}

		return nil
	})

	gotalk.Handle("login", func(s *gotalk.Sock, in User) (*Token, error) {
		user, _ := api.QueryUser(context.Background(), in.Username, db)
		if user == nil {
			log.Println("Kullanıcı bulunamadı, oluşturuluyor...")
			user, _ = api.CreateUser(context.Background(), in.Username, in.Name, in.Surname, db)
		}

		t := md5.Sum([]byte(in.Username))
		token := Token{Tkn: hex.EncodeToString(t[:])}
		user.Update().SetToken(token.Tkn).SetIsOnline(1).Save(context.Background())
		s.UserData = token.Tkn
		broadcast("isOnline", user.Username, s.UserData.(string))

		return &token, nil
	})

	gotalk.Handle("online", func(t Token) (*OnLines, error) {
		o, _ := api.QueryOnlineUsers(context.Background(), db)

		users := make([]User, 0)
		current, _ := api.QueryUserbyToken(context.Background(), t.Tkn, db)

		for _, x := range o {
			if current.Username != x.Username {
				users = append(users, User{
					Name:     x.Name,
					Surname:  x.Surname,
					Username: x.Username,
				})
			}
		}

		return &OnLines{Users: users}, nil
	})

	gotalk.Handle("getMsgs", func(token Token)([]MsgSender, error) {
		u, _ := api.QueryUserbyToken(context.Background(), token.Tkn, db)
		msgs, _ := api.QueryLastMessages(context.Background(), u)
		result := make([]MsgSender, 0)
		var tmp MsgSender
		for _, msg := range(msgs) {
			tmp = MsgSender{
				Text:   msg.Message,
				Sender: msg.SenderUsername,
			}
			result = append(result, tmp)
		}

		return result, nil
	})

	// Serve gotalk at "/gotalk/"
	gh := gotalk.WebSocketHandler()
	gh.OnConnect = onConnect
	routes := &http.ServeMux{}
	server := &http.Server{Addr: "0.0.0.0:1234", Handler: routes}
	routes.Handle("/gotalk/", gh)

	// Start server
	fmt.Printf("Listening on http://%s/\n", server.Addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		panic(err)
	}
}

func main() {
	server()
}