# Implement static site generator for blog

Sample code for my talk in
[UIT meetup vol.11](https://uit.connpass.com/event/197740/).

## How to use

Read [the code](index.js).

## Run the sample

```shell
# Clone the repo.
git clone https://github.com/hatashiro/uit-meetup-11.git
cd uit-meetup-11

# Run the static site generator for the sample blog.
node index.js --src blog --out docs

# Check the result.
open docs/index.html
```

Note that the `docs/` directory is [Git-ignored](.gitignore).

## License

[ISC](LICENSE)
