# Firebase backend

The client-facing rules intentionally deny direct writes for published revisions, memberships, and append-only event history. Authoritative mutations pass through backend functions/services so role and relationship-scope checks are enforced independently of UI visibility.

Cloud Storage revision downloads are scoped to active Company membership by looking up the matching Firestore membership document from Storage Security Rules. Revision uploads remain server-authoritative. When these rules are first deployed, Firebase may require enabling the permission that allows Storage Security Rules to consult the default Firestore database.

Before production, run both Firestore and Storage rule tests in the Firebase Local Emulator Suite and add App Check to the public clients. Server SDK code still requires its own IAM/service-account controls because Admin SDK access is not constrained by Firestore client Security Rules.
