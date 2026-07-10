# Orthodox Routes — Product Map

This document visualizes the current product concept.

It must stay synchronized with the product concept. Any change that affects screens, buttons, user journeys, public/private visibility, status logic, or entity relationships must update this file in the same task.

## Product Principle

Orthodox Routes is not an Orthodox Uber.

It is a church transport board where drivers and passengers coordinate rides to a specific church service.

The central screen is the church page. The church page works as a transport board for that church.

## 1. Product Overview

```mermaid
flowchart TD
    A["Orthodox Routes<br/>Православные маршруты"] --> B["Church Page<br/>Transport Board"]

    B --> C["Church information"]
    B --> C1["Church image or local fallback"]
    B --> D["Service schedule"]
    B --> E["Active driver offers"]
    B --> F["Active passenger requests"]
    B --> G["Page-level creation actions"]
    B --> H["Temporary personal mock panels<br/>not public church content"]

    E --> E1["One-time driver trips"]
    E --> E2["Regular driver routes"]
    E1 --> E3["Driver offer card"]
    E2 --> E3
    E3 --> E4["Button: Попросить подвезти"]
    E4 --> E5["Passenger asks this specific driver for a seat"]

    F --> F1["Passenger request card"]
    F1 --> F2["Button: Подвезти"]
    F2 --> F3["Driver responds to this specific passenger request"]

    G --> G1["Создать запрос<br/>Passenger creates an open request"]
    G --> G2["Создать поездку / маршрут<br/>Driver creates an offer"]

    H --> H1["Мои уведомления"]
    H --> H2["Мой отклик<br/>only after driver response"]
    H --> H3["Мой запрос водителю<br/>only after targeted request"]

    E5 --> M["Potential match"]
    F3 --> M

    M --> M1{"Both sides confirmed?"}
    M1 -->|Yes| M2["RideMatch created"]
    M2 --> M3["Contacts shared only with participants"]
    M2 --> M4["Passenger request hidden from public board"]
    M2 --> M5["Driver offer seats decrease"]

    M5 --> M6{"Free seats left?"}
    M6 -->|Yes| M7["Driver offer remains visible"]
    M6 -->|No| M8["Driver offer hidden from public board"]

    M1 -->|No| M9["No public contact sharing"]
```

## 2. Church Page Public Board

```mermaid
flowchart TD
    CP["Church Page"] --> INFO["Church Info"]
    CP --> HERO["Church image<br/>or local fallback illustration"]
    CP --> SCHEDULE["Service Schedule"]
    CP --> OFFERS["Block: Кто едет и может подвезти"]
    CP --> REQUESTS["Block: Кому нужно место"]
    CP --> CREATE["Page-level creation actions"]
    CP --> PERSONAL["Temporary personal mock UI<br/>not public board content"]

    OFFERS --> O1["Driver Offer Card"]
    O1 --> O2["Driver name"]
    O1 --> O3["Approximate departure area"]
    O1 --> O4["Service / date / time"]
    O1 --> O5["Free seats"]
    O1 --> O6["Offer type:<br/>one-time trip or regular route"]
    O1 --> O7["Button: Попросить подвезти"]

    REQUESTS --> R1["Passenger Request Card"]
    R1 --> R2["Passenger first name"]
    R1 --> R3["Approximate pickup area or hub"]
    R1 --> R4["Number of passengers"]
    R1 --> R5["Service / date / time"]
    R1 --> R6["Short safe comment"]
    R1 --> R7["Button: Подвезти"]

    CREATE --> C1["Создать запрос"]
    CREATE --> C2["Создать поездку / маршрут"]

    O7 --> T1["Creates targeted passenger request to this driver offer"]
    R7 --> T2["Creates driver response to this passenger request"]

    PERSONAL --> P1["Мои уведомления"]
    PERSONAL --> P2["Мой отклик<br/>conditional"]
    PERSONAL --> P3["Мой запрос водителю<br/>conditional"]
```

## 3. Passenger Journey

```mermaid
flowchart TD
    P0["Passenger opens app"] --> P1["Language detected from browser/device"]
    P1 --> P2["Passenger searches or opens a church"]
    P2 --> P3["Passenger views church transport board"]

    P3 --> A{"Is there a suitable driver offer?"}

    A -->|Yes| A1["Passenger opens driver offer card"]
    A1 --> A2["Clicks: Попросить подвезти"]
    A2 --> A3["Targeted request modal opens<br/>with driver and offer context"]
    A3 --> A4["Validated targeted request<br/>saved to localStorage"]
    A4 --> A4N["Personal mock notifications created"]
    A4 --> A4P["Private panel:<br/>Мой запрос водителю"]
    A4P --> A5["Current mock waits for driver<br/>no acceptance implemented"]
    A5 --> A5F["Future: driver accepts?"]
    A5F -->|Yes| A6["RideMatch created"]
    A6 --> A7["Contacts shared with participants"]
    A7 --> A8["Passenger goes to church"]
    A5F -->|No| A9["Passenger can try another offer or create open request"]

    A -->|No| B1["Passenger clicks page action: Создать запрос"]
    B1 --> B2["Validated modal opens"]
    B2 --> B3["Request saved to localStorage<br/>and appears in passenger requests block"]
    B3 --> B3M["Automatic matching checks compatible driver offers"]
    B3M --> B3N["Passenger and relevant drivers may receive suggestions"]
    B3N --> B4["Drivers see this request on church page"]
    B4 --> B5["Driver clicks: Подвезти"]
    B5 --> B6["Mock DriverResponse created"]
    B6 --> B7["Mock notification created"]
    B7 --> B8["Request hidden while response is active"]
    B8 --> B9["Passenger contact shown only in<br/>private mock panel Мой отклик"]
    B9 --> B10{"Driver cancels response?"}
    B10 -->|Yes| B11["Response cancelled"]
    B11 --> B12["Request returns to public board"]
    B10 -->|No| A8
```

## 4. Driver Journey

```mermaid
flowchart TD
    D0["Driver opens app"] --> D1["Language detected from browser/device"]
    D1 --> D2["Driver opens church page"]
    D2 --> D3["Driver views transport board"]

    D3 --> A{"Does driver want to respond to existing passenger request?"}

    A -->|Yes| A1["Driver opens passenger request card"]
    A1 --> A2["Clicks: Подвезти"]
    A2 --> A3["Driver confirms availability"]
    A3 --> A4["Driver response sent to passenger"]
    A4 --> A4N["Passenger receives notification"]
    A4N --> A5{"Passenger confirms?"}
    A5 -->|Yes| A6["RideMatch created"]
    A6 --> A7["Passenger request hidden from public board"]
    A7 --> A8["Contacts shared with participants"]
    A8 --> A9["Ride to church"]
    A5 -->|No| A10["No match; no contacts shared"]

    A -->|No| B1["Driver clicks page action:<br/>Создать поездку / маршрут"]
    B1 --> B2["Driver creates driver profile if needed"]
    B2 --> B3{"Offer type?"}
    B3 -->|One-time trip| B4["Creates one-time trip"]
    B3 -->|Regular route| B5["Creates regular route"]
    B4 --> B6["Driver offer appears on church page"]
    B5 --> B6
    B6 --> B6M["Automatic matching checks compatible passenger requests"]
    B6M --> B6N["Driver and relevant passengers may receive suggestions"]

    B6N --> B7["Passenger clicks:<br/>Попросить подвезти"]
    B7 --> B8["Driver receives targeted passenger request"]
    B8 --> B9{"Driver accepts?"}
    B9 -->|Yes| B10["RideMatch created"]
    B10 --> B11["Free seats decrease"]
    B11 --> B12{"Any free seats left?"}
    B12 -->|Yes| B13["Offer remains public"]
    B12 -->|No| B14["Offer hidden from public board"]
    B10 --> B15["Contacts shared with participants"]
    B15 --> A9
    B9 -->|No| B16["Request declined; offer remains if seats available"]
```

## 5. Entity Relationships

```mermaid
erDiagram
    CHURCH ||--o{ SERVICE_EVENT : has
    CHURCH ||--o{ DRIVER_OFFER : shows
    CHURCH ||--o{ PASSENGER_REQUEST : shows
    CHURCH ||--o{ PARISH_COORDINATOR_PROFILE : may_have

    USER ||--o| PASSENGER_PROFILE : may_have
    USER ||--o| DRIVER_PROFILE : may_have
    USER ||--o| PARISH_COORDINATOR_PROFILE : may_have

    DRIVER_PROFILE ||--o{ DRIVER_OFFER : creates
    PASSENGER_PROFILE ||--o{ PASSENGER_REQUEST : creates

    DRIVER_OFFER ||--o{ PASSENGER_REQUEST : may_receive_targeted_requests
    PASSENGER_REQUEST ||--o{ DRIVER_RESPONSE : may_receive
    DRIVER_PROFILE ||--o{ DRIVER_RESPONSE : creates

    PASSENGER_REQUEST ||--o| RIDE_MATCH : may_be_matched_by
    DRIVER_OFFER ||--o| RIDE_MATCH : may_be_used_in
    DRIVER_RESPONSE ||--o| RIDE_MATCH : may_create
    PASSENGER_REQUEST ||--o{ MATCH_SUGGESTION : may_generate
    DRIVER_OFFER ||--o{ MATCH_SUGGESTION : may_generate
    USER ||--o{ NOTIFICATION : receives

    HUB_POINT ||--o{ PASSENGER_REQUEST : may_be_pickup_area
    HUB_POINT ||--o{ DRIVER_OFFER : may_be_stop

    CHURCH {
        string id
        string name
        string slug
        string jurisdiction
        string address
        string languages
        string publicContact
        string imageUrl
        string imageAlt
        string imageSource
    }

    SERVICE_EVENT {
        string id
        string churchId
        string title
        datetime startsAt
        string serviceType
    }

    USER {
        string id
        string name
        string preferredLanguage
        string phonePrivate
        string emailPrivate
    }

    PASSENGER_PROFILE {
        string id
        string userId
        string firstName
        string preferredLanguage
        string contactPrivate
    }

    DRIVER_PROFILE {
        string id
        string userId
        string publicName
        string approximateArea
        string contactPrivate
        string verificationStatus
    }

    DRIVER_OFFER {
        string id
        string driverId
        string churchId
        string serviceEventId
        string offerType
        string approximateDepartureArea
        int freeSeats
        string status
        boolean publicVisible
    }

    PASSENGER_REQUEST {
        string id
        string passengerId
        string churchId
        string serviceEventId
        string targetDriverOfferId
        string approximatePickupArea
        int passengerCount
        string safePublicComment
        string status
        boolean publicVisible
    }

    DRIVER_RESPONSE {
        string id
        string driverId
        string passengerRequestId
        string message
        string status
    }

    MATCH_SUGGESTION {
        string id
        string churchId
        string serviceEventId
        string passengerRequestId
        string driverOfferId
        string priority
        string reason
        string status
    }

    NOTIFICATION {
        string id
        string recipientUserId
        string type
        string title
        string message
        string channel
        string status
    }

    RIDE_MATCH {
        string id
        string passengerRequestId
        string driverOfferId
        string driverResponseId
        string status
        datetime confirmedAt
    }

    HUB_POINT {
        string id
        string name
        string type
        string approximateAddress
    }

    PARISH_COORDINATOR_PROFILE {
        string id
        string userId
        string churchId
        string role
    }
```

## 6. Passenger Request States

```mermaid
stateDiagram-v2
    [*] --> Draft: passenger starts form

    Draft --> OpenPublicRequest: clicks Создать запрос
    Draft --> TargetedToDriverOffer: clicks Попросить подвезти

    OpenPublicRequest --> VisibleOnChurchBoard
    VisibleOnChurchBoard --> DriverResponsePending: driver clicks Подвезти
    DriverResponsePending --> HiddenFromPublicBoard: mock response active
    DriverResponsePending --> VisibleOnChurchBoard: driver cancels response
    DriverResponsePending --> Matched: future confirmation flow

    TargetedToDriverOffer --> WaitingForDriver
    WaitingForDriver --> Matched: driver accepts
    WaitingForDriver --> Declined: driver declines

    VisibleOnChurchBoard --> Cancelled: passenger cancels
    VisibleOnChurchBoard --> Expired: service time passed

    Matched --> HiddenFromPublicBoard
    HiddenFromPublicBoard --> ContactsShared
    ContactsShared --> Completed: ride completed

    Declined --> [*]
    Cancelled --> [*]
    Expired --> [*]
    Completed --> [*]
```

## 7. Driver Offer States

```mermaid
stateDiagram-v2
    [*] --> Draft: driver starts form

    Draft --> ActiveVisible: driver publishes offer

    ActiveVisible --> TargetedRequestPending: passenger clicks Попросить подвезти
    TargetedRequestPending --> ActiveVisible: driver declines
    TargetedRequestPending --> SeatAccepted: driver accepts

    SeatAccepted --> SeatsDecreased
    SeatsDecreased --> ActiveVisible: free seats remain
    SeatsDecreased --> Full: no free seats left

    ActiveVisible --> Cancelled: driver cancels
    ActiveVisible --> Expired: service time passed

    Full --> HiddenFromPublicBoard
    Cancelled --> HiddenFromPublicBoard
    Expired --> HiddenFromPublicBoard

    HiddenFromPublicBoard --> [*]
```

## 8. Public Visibility Rules

```mermaid
flowchart TD
    A["Public church board item"] --> B{"Item type"}

    B -->|Passenger request| C["Show while status is open<br/>and publicVisible = true"]
    B -->|Driver offer| D["Show while status is active<br/>and freeSeats > 0<br/>and publicVisible = true"]

    C --> C1{"Matched, cancelled, expired?"}
    C1 -->|Yes| C2["Hide from public board"]
    C1 -->|No| C3["Keep visible"]

    D --> D1{"Full, cancelled, expired?"}
    D1 -->|Yes| D2["Hide from public board"]
    D1 -->|No| D3["Keep visible"]

    C2 --> H["Keep in internal history"]
    D2 --> H
```

## 9. Button Placement Rules

```mermaid
flowchart TD
    A["Church Page"] --> B["Page-level creation actions"]
    A --> C["Driver offer cards"]
    A --> D["Passenger request cards"]

    B --> B1["Создать запрос"]
    B --> B2["Создать поездку / маршрут"]

    C --> C1["Попросить подвезти"]
    C1 --> C2["Passenger asks this specific driver"]

    D --> D1["Подвезти"]
    D1 --> D2["Driver responds to this specific passenger"]

    X["Wrong pattern"] --> X1["Do not place generic<br/>Мне нужно место / Могу подвезти<br/>as abstract church page buttons"]
```

## 10. Matching & Notifications

```mermaid
flowchart TD
    A["New activity happens"] --> B{"Activity type"}

    B -->|Passenger clicks Попросить подвезти| C["Create targeted PassengerRequest<br/>linked to DriverOffer"]
    C --> C1["Notify driver"]
    C1 --> C2{"Driver accepts?"}
    C2 -->|Yes| C3["Create RideMatch"]
    C3 --> C4["Share contacts with participants"]
    C3 --> C5["Decrease free seats"]
    C2 -->|No| C6["No match<br/>No contacts shared"]

    B -->|Driver clicks Подвезти| D["Create DriverResponse<br/>linked to PassengerRequest"]
    D --> D1["Notify passenger"]
    D1 --> D2["Current mock: hide PassengerRequest<br/>while response is active"]
    D2 --> D3["Show passenger contact only in<br/>private mock panel Мой отклик"]
    D3 --> D4{"Driver cancels response?"}
    D4 -->|Yes| D5["Cancel DriverResponse<br/>return request to public board"]
    D4 -->|No| D6["Future confirmation may create RideMatch"]

    B -->|New open PassengerRequest| E["Run automatic matching"]
    E --> E1["Find compatible active DriverOffers"]
    E1 --> E2{"Compatible offers found?"}
    E2 -->|Yes| E3["Create MatchSuggestions"]
    E3 --> E4["Notify passenger about possible drivers"]
    E3 --> E5["Notify relevant drivers about passenger request"]
    E2 -->|No| E6["Request remains visible on church board"]

    B -->|New DriverOffer| F["Run automatic matching"]
    F --> F1["Find compatible open PassengerRequests"]
    F1 --> F2{"Compatible requests found?"}
    F2 -->|Yes| F3["Create MatchSuggestions"]
    F3 --> F4["Notify driver about possible passengers"]
    F3 --> F5["Notify relevant passengers about driver offer"]
    F2 -->|No| F6["DriverOffer remains visible on church board"]
```

## 11. Automatic Matching Rules

```mermaid
flowchart TD
    A["Potential match candidate"] --> B{"Same church?"}
    B -->|No| X["Not compatible"]
    B -->|Yes| C{"Same or compatible service/date?"}

    C -->|No| X
    C -->|Yes| D{"Driver offer has free seats?"}

    D -->|No| X
    D -->|Yes| E{"Passenger request is open?"}

    E -->|No| X
    E -->|Yes| F{"Pickup area or hub compatible enough?"}

    F -->|No| Y["Low priority or no suggestion"]
    F -->|Yes| G{"Both items publicVisible?"}

    G -->|No| X
    G -->|Yes| H["Create MatchSuggestion"]

    H --> I["Notify relevant users"]
```

## 12. Current Mock Passenger Request Flow

```mermaid
flowchart TD
    A["Passenger clicks page action:<br/>Создать запрос"] --> B["Modal opens without visible registration"]
    B --> C["Passenger enters request data"]
    C --> C1{"Phone and optional email valid?<br/>Consent checked?"}
    C1 -->|No| C2["Show field validation messages"]
    C2 --> C
    C1 -->|Yes| D["Create open PassengerRequest"]
    D --> E["Persist in namespaced localStorage"]
    E --> F["Request appears in Кому нужно место"]
    E --> G["Personal mock notification created"]
    E --> H["Run simple mock matching"]
    H --> I{"Compatible visible offer exists?"}
    I -->|Yes| J["Personal mock notification:<br/>Найдены возможные водители"]
    I -->|No| F

    F --> K["Driver clicks Подвезти<br/>on request card"]
    K --> L["Persist mock DriverResponse"]
    L --> M["Personal mock notification created"]
    L --> N["Request hidden from public list"]
    L --> O["Private panel Мой отклик appears<br/>with passenger contact"]

    O --> P["Driver clicks Отменить отклик"]
    P --> Q{"Confirm cancellation?"}
    Q -->|Yes| R["Persist cancelled response"]
    R --> S["Request returns to public list"]
    R --> T["Personal mock notification:<br/>Отклик отменен"]
    Q -->|No| O
```

## 13. Targeted Request and Mock Persistence

```mermaid
flowchart TD
    A["Passenger clicks Попросить подвезти<br/>on route or trip card"] --> B["Targeted request modal opens"]
    B --> C["Show driver and offer context"]
    C --> D["Validate international phone,<br/>optional email, count, pickup, consent"]
    D --> E["Create targeted PassengerRequest<br/>publicVisible = false"]
    E --> F["Persist in<br/>orthodox-routes:targeted-requests"]
    F --> G["Do not show in Кому нужно место"]
    F --> H["Show private panel:<br/>Мой запрос водителю"]
    F --> I["Persist personal mock notifications"]
    H --> J["Contacts remain private<br/>driver acceptance not implemented"]

    LS["Namespaced localStorage"] --> L1["passenger-requests"]
    LS --> L2["driver-responses"]
    LS --> L3["targeted-requests"]
    LS --> L4["notifications"]
    L1 --> R["State survives navigation,<br/>back/forward, and refresh"]
    L2 --> R
    L3 --> R
    L4 --> R
```

## 14. Personal Notifications and Delivery

```mermaid
flowchart LR
    A["Product event"] --> B["Personal Notification record"]
    B --> C["Production personal notification center"]
    B --> D["Future MVP delivery channel"]
    D --> D1["Web push / PWA push"]
    D --> D2["Email"]
    B --> E["Later possible channel:<br/>Telegram bot"]

    M["Current mock"] --> M1["localStorage notification"]
    M1 --> M2["Temporary Мои уведомления block<br/>on church page for testing only"]

    X["Privacy"] --> X1["Never show another user's notifications"]
    X --> X2["Never include phone or email in notification text"]
```
