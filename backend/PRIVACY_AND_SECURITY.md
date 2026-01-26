# Data Privacy and Security Statement

At Bautista Planning and Analytics, we understand that the security and privacy of your financial data are paramount. This document outlines the measures we take to protect your information and our commitment to your privacy.

## Our Commitment to Your Data Security

We employ industry-standard security practices and leverage robust third-party services to ensure your data is safe and secure.

### 1. Secure Authentication (Powered by Supabase)

*   **No Direct Password Storage**: We **do not** store your login passwords directly in our application's database. Instead, we use **Supabase Auth**, a leading authentication service. Supabase securely handles your login credentials using advanced hashing and encryption techniques. This means even we cannot access your raw password.
*   **JSON Web Tokens (JWTs)**: After you log in, Supabase issues a secure JSON Web Token (JWT). This token is used to verify your identity for all subsequent interactions with our backend. JWTs are cryptographically signed, making them tamper-proof and ensuring that only you can access your data.
*   **Session Management**: Your session is securely managed by the Supabase client, which handles token refreshing and expiration, further reducing the risk of unauthorized access.

### 2. Data Protection and Isolation

*   **Supabase Database**: Your financial data (transactions, summaries, etc.) is stored in a secure PostgreSQL database managed by Supabase. Supabase provides enterprise-grade security features, including data encryption at rest and in transit.
*   **Row Level Security (RLS)**: We implement **Row Level Security (RLS)** policies on our database tables. This is a powerful security feature that ensures:
    *   **Data Isolation**: You can only access and view your own financial data. One client cannot accidentally or maliciously view another client's information.
    *   **Role-Based Access**: Our administrative staff (Advisors) have controlled access to client data only when necessary for providing services, and their access is also governed by strict RLS policies.
*   **Encryption**: All data transmitted between your browser and our servers, and between our servers and Supabase, is encrypted using HTTPS (TLS/SSL). Data stored in the Supabase database is also encrypted at rest.

### 3. No Data Selling or Sharing

*   **Your Data is Yours**: We unequivocally state that we **do not sell, rent, or trade your personal or financial data** to any third parties for marketing or any other purposes.
*   **Purpose of Data Collection**: Your data is collected solely for the purpose of providing you with personalized financial insights, transaction categorization, and reporting services within this web application.

### 4. Regular Security Audits and Updates

We are committed to continuously monitoring and updating our security practices to adapt to new threats and technologies. Our use of managed services like Supabase ensures that underlying infrastructure security is handled by experts.

## Your Role in Security

While we take extensive measures to protect your data, your active participation is also crucial:

*   **Strong Passwords**: Always use a strong, unique password for your account.
*   **Keep Credentials Private**: Never share your login credentials with anyone.
*   **Monitor Your Accounts**: Regularly review your financial accounts for any suspicious activity.

## Privacy Policy

For a more detailed explanation of how we collect, use, and protect your personal information, please refer to our full Privacy Policy.

[Link to Your Privacy Policy Here] (e.g., `https://yourwebapp.com/privacy-policy`)

---

**Disclaimer**: This document provides a general overview of security and privacy measures. It is not a substitute for legal advice. You should consult with a legal professional to draft a comprehensive Privacy Policy and Terms of Service that comply with all relevant laws and regulations for your specific business and jurisdiction.
