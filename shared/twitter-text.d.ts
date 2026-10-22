declare module 'twitter-text' {
  export type ParsedTweet = {
    weightedLength: number;
    valid: boolean;
    permillage: number;
    validRangeStart: number;
    validRangeEnd: number;
    displayRangeStart: number;
    displayRangeEnd: number;
  };

  export interface TwitterTextApi {
    parseTweet(text: string): ParsedTweet;
  }

  const twitterText: TwitterTextApi;
  export default twitterText;
}
