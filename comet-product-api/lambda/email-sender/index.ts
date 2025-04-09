import { SESClient, SendEmailCommand, SendEmailCommandInput } from "@aws-sdk/client-ses";
import { SNSEvent, SNSHandler } from 'aws-lambda';

const sesClient = new SESClient({});

// Ne pas lire les variables d'env ici
// const SENDER_EMAIL_ADDRESS = process.env.SENDER_EMAIL_ADDRESS;
// const RECIPIENT_EMAIL_ADDRESS = process.env.RECIPIENT_EMAIL_ADDRESS;

interface ProductEventPayload {
    productId: string;
    name: string;
    price: number;
    // Ajoutez d'autres champs si nécessaire
}

export const handler: SNSHandler = async (event: SNSEvent): Promise<void> => {
  console.log('Received SNS event:', JSON.stringify(event, null, 2));

  // Lire les variables d'env ici, à chaque invocation
  const senderEmailAddress = process.env.SENDER_EMAIL_ADDRESS;
  const recipientEmailAddress = process.env.RECIPIENT_EMAIL_ADDRESS;

  if (!senderEmailAddress || !recipientEmailAddress) {
    console.error("Configuration error: Missing sender or recipient email address.");
    // Vous pourriez vouloir une notification d'erreur ici (ex: CloudWatch Alarm)
    return;
  }

  for (const record of event.Records) {
    const snsMessage = record.Sns;
    const messageAttributes = snsMessage.MessageAttributes;

    // Optionnel: Filtrer les messages basé sur les attributs (si vous avez plusieurs types d'événements)
    if (messageAttributes.eventType?.Value !== 'ProductCreated') {
      console.log(`Skipping message with eventType: ${messageAttributes.eventType?.Value}`);
      continue;
    }

    let productData: ProductEventPayload;
    try {
      productData = JSON.parse(snsMessage.Message);
      console.log('Parsed product data:', productData);
    } catch (error) {
      console.error("Error parsing SNS message body:", error);
      continue; // Passer au message suivant en cas d'erreur de parsing
    }

    const { productId, name, price } = productData;

    const emailSubject = `Nouveau Produit Ajouté: ${name}`;
    const emailBody = `
      <p>Un nouveau produit a été ajouté à la base de données:</p>
      <ul>
        <li><strong>ID:</strong> ${productId}</li>
        <li><strong>Nom:</strong> ${name}</li>
        <li><strong>Prix:</strong> ${price} €</li>
      </ul>
      <p>Ceci est un email automatique.</p>
    `;

    const sendEmailParams: SendEmailCommandInput = {
      Source: senderEmailAddress,
      Destination: {
        ToAddresses: [recipientEmailAddress],
        // CcAddresses: [],
        // BccAddresses: [],
      },
      Message: {
        Subject: {
          Data: emailSubject,
          Charset: 'UTF-8',
        },
        Body: {
          Html: {
            Data: emailBody,
            Charset: 'UTF-8',
          },
          // Text: { Data: textBody, Charset: 'UTF-8' } // Version texte brut optionnelle
        },
      },
      // ReplyToAddresses: [],
      // ReturnPath: '',
      // SourceArn: '',
      // ReturnPathArn: '',
      // Tags: [],
      // ConfigurationSetName: '',
    };

    try {
      const command = new SendEmailCommand(sendEmailParams);
      const result = await sesClient.send(command);
      console.log(`Email sent successfully for product ${productId}. Message ID: ${result.MessageId}`);
    } catch (error) {
      console.error(`Error sending email for product ${productId}:`, error);
      // Gérer l'erreur d'envoi d'email (ex: re-tentative, log spécifique)
    }
  }
}; 